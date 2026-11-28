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
})
export type PatientInput = z.infer<typeof patientInput>

export const patientAdminBody = z.object({
  documentType: z.enum(['DNI', 'PAS', 'LE', 'LC', 'CI', 'OTRO']).default('DNI'),
  document: documentSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: z.string().trim().max(30).regex(/^[\d\s()+-]*$/, 'Teléfono inválido').nullish(),
  email: z.string().trim().max(120).email('Email inválido').nullish().or(z.literal('')),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').nullish().or(z.literal('')),
  notes: z.string().trim().max(500).nullish(),
})

/**
 * Saludo para el tótem sin exponer datos completos: "María G."
 * El tótem es público; mostrar nombre y apellido completos por DNI permitiría consultar datos de terceros.
 */
export const greetingName = (first: string, last: string) => `${first.split(' ')[0]} ${last.charAt(0)}.`

export async function findPatient(ctx: Ctx, document: string) {
  return ctx.db.selectFrom('patients').selectAll().where('document', '=', document).where('active', '=', 1).executeTakeFirst()
}

/**
 * Resuelve el paciente para un turno: si existe lo devuelve; si no existe y vienen nombre y apellido lo crea.
 * Si no existe y faltan datos, responde 409 para que el tótem muestre el formulario de registro.
 */
export async function resolvePatientForTicket(ctx: Ctx, input: PatientInput) {
  const existing = await findPatient(ctx, input.document)
  if (existing) return existing
  if (!input.firstName || !input.lastName) throw new HttpError(409, 'patient_not_found')
  const now = nowIso()
  try {
    const id = await insertId(ctx, ctx.db, 'patients', {
      document_type: 'DNI',
      document: input.document,
      first_name: input.firstName,
      last_name: input.lastName,
      phone: null,
      email: null,
      birth_date: null,
      notes: null,
      search_name: searchKey(input.firstName, input.lastName),
      visits: 0,
      last_visit_at: null,
      source: 'totem',
      active: 1,
      created_at: now,
      updated_at: now,
    })
    return (await ctx.db.selectFrom('patients').selectAll().where('id', '=', id).executeTakeFirstOrThrow())
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
