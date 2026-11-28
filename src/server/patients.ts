import { z } from 'zod'
import type { Ctx } from './db.js'
import { insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'

/** Texto de búsqueda: minúsculas y sin tildes ("Pérez" → "perez"). */
export const searchKey = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 170)

/** DNI/pasaporte: solo letras y números, sin puntos ni espacios, en mayúsculas. */
export const normalizeDocument = (raw: string) => raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase()

export const documentSchema = z
  .string()
  .trim()
  .max(24)
  .transform(normalizeDocument)
  .refine((d) => /^[0-9A-Z]{6,15}$/.test(d), 'El documento debe tener entre 6 y 15 números o letras')

const nameSchema = z
  .string()
  .trim()
  .min(2, 'Escribí al menos 2 letras')
  .max(80)
  .regex(/^[\p{L}\p{M}' .-]+$/u, 'El nombre solo puede tener letras')
  .transform((s) => s.replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()))

export const patientInput = z.object({
  document: documentSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  /** El paciente aceptó el uso de sus datos (obligatorio al registrarse). */
  consent: z.boolean().optional(),
})
export type PatientInput = z.infer<typeof patientInput>

/** Datos que la secretaria puede completar al atender. */
export const patientDeskBody = z.object({
  phone: z.string().trim().max(30).regex(/^[\d\s()+-]*$/, 'Teléfono inválido').nullish(),
  healthInsurance: z.string().trim().max(80).nullish(),
  insuranceNumber: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(500).nullish(),
})

export const CONSENT_VERSION = '2026-11'

/**
 * Saludo para el tótem sin exponer datos completos: "María G."
 * El tótem es público; mostrar nombre y apellido completos por DNI permitiría consultar datos de terceros.
 */
export const greetingName = (first: string, last: string) => `${first.split(' ')[0]} ${last.charAt(0)}.`

/** Busca por el hash del documento: el DNI nunca se guarda ni se compara en claro. */
export async function findPatient(ctx: Ctx, document: string) {
  return ctx.db.selectFrom('patients').selectAll().where('document_hash', '=', ctx.crypto.hash(document)).where('active', '=', 1).executeTakeFirst()
}

/**
 * Resuelve el paciente para un turno: si existe lo devuelve; si no existe y vienen nombre, apellido y
 * consentimiento, lo crea. Si faltan datos responde 409 para que el tótem muestre el formulario de registro.
 */
export async function resolvePatientForTicket(ctx: Ctx, input: PatientInput) {
  const existing = await findPatient(ctx, input.document)
  if (existing) return existing
  if (!input.firstName || !input.lastName) throw new HttpError(409, 'patient_not_found')
  if (!input.consent) throw new HttpError(400, 'Para registrarte tenés que aceptar el uso de tus datos')
  const now = nowIso()
  try {
    const id = await insertId(ctx, ctx.db, 'patients', {
      document_type: 'DNI',
      document: null,
      document_hash: ctx.crypto.hash(input.document),
      document_enc: ctx.crypto.encrypt(input.document),
      document_last4: input.document.slice(-4),
      first_name: input.firstName,
      last_name: input.lastName,
      phone: null,
      email: null,
      birth_date: null,
      notes: null,
      search_name: searchKey(input.firstName, input.lastName),
      consent_at: now,
      consent_version: CONSENT_VERSION,
      health_insurance: null,
      insurance_number: null,
      visits: 0,
      last_visit_at: null,
      source: 'totem',
      active: 1,
      created_at: now,
      updated_at: now,
    })
    return await ctx.db.selectFrom('patients').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
  } catch (e) {
    // Dos tótems registrando el mismo DNI a la vez: el índice único gana y usamos el existente
    const again = await findPatient(ctx, input.document)
    if (again) return again
    throw e
  }
}

export async function registerVisit(ctx: Ctx, patientId: number) {
  await ctx.db
    .updateTable('patients')
    .set((eb) => ({ visits: eb('visits', '+', 1), last_visit_at: nowIso(), updated_at: nowIso() }))
    .where('id', '=', patientId)
    .execute()
}

/**
 * Al iniciar: cifra los DNI que quedaron en claro (instalaciones anteriores a la migración 005)
 * y borra la copia del documento que se guardaba en cada turno.
 */
export async function encryptLegacyDocuments(ctx: Ctx) {
  const rows = await ctx.db.selectFrom('patients').select(['id', 'document']).where('document', 'is not', null).where('document_hash', 'is', null).execute()
  for (const r of rows) {
    const doc = r.document!
    await ctx.db
      .updateTable('patients')
      .set({ document_hash: ctx.crypto.hash(doc), document_enc: ctx.crypto.encrypt(doc), document_last4: doc.slice(-4), document: null })
      .where('id', '=', r.id)
      .execute()
  }
  const t = await ctx.db.updateTable('tickets').set({ dni: null }).where('dni', 'is not', null).executeTakeFirst()
  return { patients: rows.length, tickets: Number(t.numUpdatedRows) }
}

/**
 * Política de conservación: los pacientes sin visitas en N meses se anonimizan
 * (se borran nombre y documento; los turnos quedan para las estadísticas).
 */
export async function applyRetention(ctx: Ctx, months: number) {
  if (!months || months <= 0) return 0
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const r = await ctx.db
    .updateTable('patients')
    .set({
      active: 0, first_name: 'Paciente', last_name: 'anonimizado', search_name: '', document: null, document_hash: null, document_enc: null,
      document_last4: null, phone: null, email: null, birth_date: null, notes: null, health_insurance: null, insurance_number: null, updated_at: nowIso(),
    })
    .where('active', '=', 1)
    .where((eb) => eb.or([eb('last_visit_at', '<', cutoff.toISOString()), eb.and([eb('last_visit_at', 'is', null), eb('created_at', '<', cutoff.toISOString())])]))
    .executeTakeFirst()
  return Number(r.numUpdatedRows)
}
