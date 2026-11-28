import { randomBytes } from 'node:crypto'
import type { Ctx } from './db.js'
import { businessDate, insertId, nextCounterValue, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { getSettings, mediaUrlList } from './settings.js'
import type { AuthUser } from './types.js'
import { registerVisit, resolvePatientForTicket, type PatientInput } from './patients.js'
import { metrics } from './monitor.js'

const today = (ctx: Ctx) => businessDate(ctx.cfg.timezone)
const mins = (a?: string | null, b?: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : null)
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null && x >= 0); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null }

/**
 * Espera estimada = personas adelante × tiempo medio de atención ÷ puestos atendiendo.
 * Tiempo medio: últimos 30 turnos atendidos hoy en la secretaría (5 min si no hay datos).
 * Puestos: usuarios distintos que llamaron en la última hora (mínimo 1).
 */
export async function estimateWait(ctx: Ctx, sectorId: number, ahead: number): Promise<number> {
  const date = today(ctx)
  const done = await ctx.db.selectFrom('tickets').select(['called_at', 'started_at', 'finished_at'])
    .where('sector_id', '=', sectorId).where('business_date', '=', date).where('status', '=', 'done')
    .orderBy('id', 'desc').limit(30).execute()
  const service = avg(done.map((x) => mins(x.started_at ?? x.called_at, x.finished_at))) ?? 5
  const since = new Date(Date.now() - 3600_000).toISOString()
  const desks = await ctx.db.selectFrom('tickets').select('called_by').distinct()
    .where('sector_id', '=', sectorId).where('business_date', '=', date).where('called_by', 'is not', null)
    .where('called_at', '>=', since).execute()
  const activeDesks = Math.max(1, desks.length)
  return Math.max(1, Math.round((ahead * Math.max(service, 0.5)) / activeDesks))
}

/** Datos de un turno emitido por el tótem mientras no tenía conexión. */
export type OfflineTicket = { ref: string; code: string; createdAt: string }

export async function createTicket(ctx: Ctx, buttonId: number, patient?: PatientInput | null, offline?: OfflineTicket) {
  const btn = await ctx.db.selectFrom('buttons').selectAll().where('id', '=', buttonId).where('active', '=', 1).executeTakeFirst()
  if (!btn) throw new HttpError(404, 'Este botón no está disponible')
  const sector = await ctx.db.selectFrom('sectors').selectAll().where('id', '=', btn.target_sector_id).where('active', '=', 1).executeTakeFirst()
  if (!sector) throw new HttpError(409, 'La cola de este botón no está activa')
  let priorityWeight = btn.priority
  let priorityId = (btn as any).priority_id ?? null
  if (priorityId) {
    const pr = await ctx.db.selectFrom('priorities').select(['id', 'weight']).where('id', '=', priorityId).where('active', '=', 1).executeTakeFirst()
    if (pr) { priorityWeight = pr.weight; priorityId = pr.id }
  }
  const settings = await getSettings(ctx)
  if (!settings.priorities_enabled && priorityWeight > 0) throw new HttpError(404, 'Este botón no está disponible')
  if (!settings.priorities_enabled) priorityWeight = 0
  // Identificación del paciente según la configuración del tótem
  let pat: { id: number; first_name: string; last_name: string } | null = null
  if (settings.totem_patient_mode !== 'off' && patient?.document) pat = await resolvePatientForTicket(ctx, patient)
  else if (settings.totem_patient_mode === 'required') throw new HttpError(400, 'Ingresá tu número de documento')
  const now = offline?.createdAt ?? nowIso()
  const date = offline ? businessDate(ctx.cfg.timezone, new Date(now)) : today(ctx)
  const publicToken = randomBytes(12).toString('base64url')
  const t = await ctx.db.transaction().execute(async (trx) => {
    // En línea: número correlativo. Sin conexión: el código que imprimió el tótem (p. ej. A-T3-001)
    const n = offline ? 0 : await nextCounterValue(ctx, trx, `${date}|${btn.prefix}`)
    let code = offline ? offline.code : `${btn.prefix}-${String(n).padStart(3, '0')}`
    if (offline && (await trx.selectFrom('tickets').select('id').where('business_date', '=', date).where('code', '=', code).executeTakeFirst()))
      code = `${code.slice(0, 10)}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 12)
    const id = await insertId(ctx, trx, 'tickets', {
      code, prefix: btn.prefix, number: n, business_date: date, button_id: btn.id, sector_id: sector.id, origin_sector_id: btn.sector_id,
      priority: priorityWeight, priority_id: priorityId, status: 'waiting', created_at: now, called_at: null, last_call_at: null, started_at: null, finished_at: null,
      called_by: null, desk: null, desk_id: null, recall_count: 0, print_count: 0, dni: null, patient_id: pat?.id ?? null,
      public_token: publicToken, offline_ref: offline?.ref ?? null, origin: offline ? 'offline' : 'online',
    })
    await trx.insertInto('ticket_events').values({ ticket_id: id, type: 'created', user_id: null, data: null, created_at: now }).execute()
    return { id, code, number: n }
  })
  const ahead = await ctx.db.selectFrom('tickets').select((eb) => eb.fn.countAll<number>().as('n'))
    .where('sector_id', '=', sector.id).where('status', '=', 'waiting').where('business_date', '=', date).where('id', '!=', t.id)
    .where((eb) => eb.or([eb('priority', '>', priorityWeight), eb.and([eb('priority', '=', priorityWeight), eb('created_at', '<=', now)])]))
    .executeTakeFirstOrThrow()
  if (pat) await registerVisit(ctx, pat.id)
  metrics.ticket()
  ctx.hub.broadcast({ type: 'queue', sectorIds: [sector.id] })
  const estimatedWaitMin = settings.wait_estimate_enabled ? await estimateWait(ctx, sector.id, Number(ahead.n)) : null
  return {
    id: t.id,
    code: t.code,
    label: btn.label,
    sectorName: sector.name,
    color: btn.color ?? sector.color,
    priorityName: settings.priorities_enabled && priorityId ? (await ctx.db.selectFrom('priorities').select('name').where('id', '=', priorityId).executeTakeFirst())?.name ?? null : null,
    waitingAhead: Number(ahead.n),
    estimatedWaitMin,
    createdAt: now,
    qrPath: settings.qr_ticket_enabled ? `/t/${publicToken}` : null,
    patientName: pat ? pat.first_name.split(' ')[0] : null,
  }
}

async function announce(ctx: Ctx, ticketId: number, recall: boolean) {
  const t = await ctx.db.selectFrom('tickets').innerJoin('sectors', 'sectors.id', 'tickets.sector_id')
    .select(['tickets.id', 'tickets.code', 'tickets.prefix', 'tickets.number', 'tickets.desk', 'tickets.sector_id', 'sectors.name as sector_name', 'sectors.color'])
    .where('tickets.id', '=', ticketId).executeTakeFirst()
  if (!t) return
  metrics.call()
  ctx.hub.broadcast({ type: 'call', recall, ticket: { id: t.id, code: t.code, prefix: t.prefix, number: t.number, desk: t.desk, sectorId: t.sector_id, sectorName: t.sector_name, color: t.color, at: nowIso() } })
  ctx.hub.broadcast({ type: 'queue', sectorIds: [t.sector_id] })
}

const needSector = (u: AuthUser) => { if (!u.sectorId) throw new HttpError(403, 'Tu usuario no tiene una secretaría asignada'); return u.sectorId }

async function myCurrent(ctx: Ctx, u: AuthUser) {
  return ctx.db.selectFrom('tickets').selectAll().where('called_by', '=', u.id).where('status', 'in', ['called', 'serving']).where('business_date', '=', today(ctx)).executeTakeFirst()
}

async function takeTicket(ctx: Ctx, u: AuthUser, pick: () => Promise<number | undefined>) {
  const sid = needSector(u)
  if (await myCurrent(ctx, u)) throw new HttpError(409, 'Ya tenés un turno en curso. Finalizalo o marcalo como ausente.')
  for (let i = 0; i < 8; i++) {
    const id = await pick()
    if (id === undefined) throw new HttpError(404, 'No hay turnos en espera')
    const now = nowIso()
    const r = await ctx.db.updateTable('tickets').set({ status: 'called', called_at: now, last_call_at: now, called_by: u.id, desk: u.desk, desk_id: u.deskId, recall_count: 0 })
      .where('id', '=', id).where('status', '=', 'waiting').where('sector_id', '=', sid).executeTakeFirst()
    if (Number(r.numUpdatedRows) > 0) {
      await ctx.db.insertInto('ticket_events').values({ ticket_id: id, type: 'called', user_id: u.id, data: null, created_at: now }).execute()
      await announce(ctx, id, false)
      return
    }
  }
  throw new HttpError(409, 'Otro puesto tomó ese turno. Probá de nuevo.')
}

export async function callNext(ctx: Ctx, u: AuthUser) {
  await takeTicket(ctx, u, async () => (await ctx.db.selectFrom('tickets').select('id').where('sector_id', '=', u.sectorId ?? 0).where('status', '=', 'waiting')
    .where('business_date', '=', today(ctx)).orderBy('priority', 'desc').orderBy('created_at').orderBy('id').limit(1).executeTakeFirst())?.id)
}

export async function callSpecific(ctx: Ctx, u: AuthUser, ticketId: number) {
  await takeTicket(ctx, u, async () => (await ctx.db.selectFrom('tickets').select('id').where('id', '=', ticketId).where('sector_id', '=', u.sectorId ?? 0)
    .where('status', '=', 'waiting').where('business_date', '=', today(ctx)).executeTakeFirst())?.id)
}

async function transition(ctx: Ctx, u: AuthUser, from: string[], patch: Record<string, unknown>, type: string, data?: string, extraSectors: number[] = []) {
  needSector(u)
  const t = await myCurrent(ctx, u)
  if (!t) throw new HttpError(404, 'No tenés un turno en curso')
  if (!from.includes(t.status)) throw new HttpError(409, 'Esa acción no está disponible para este turno')
  const now = nowIso()
  const r = await ctx.db.updateTable('tickets').set(patch as any).where('id', '=', t.id).where('status', '=', t.status).executeTakeFirst()
  if (Number(r.numUpdatedRows) === 0) throw new HttpError(409, 'El turno cambió de estado. Actualizá la pantalla.')
  await ctx.db.insertInto('ticket_events').values({ ticket_id: t.id, type, user_id: u.id, data: data ?? null, created_at: now }).execute()
  ctx.hub.broadcast({ type: 'queue', sectorIds: [t.sector_id, ...extraSectors] })
  return t
}

export async function recall(ctx: Ctx, u: AuthUser) {
  const t = await myCurrent(ctx, u)
  if (!t) throw new HttpError(404, 'No tenés un turno en curso')
  if (t.status !== 'called') throw new HttpError(409, 'Solo se puede volver a llamar antes de iniciar la atención')
  const now = nowIso()
  await ctx.db.updateTable('tickets').set({ last_call_at: now, recall_count: t.recall_count + 1 }).where('id', '=', t.id).execute()
  await ctx.db.insertInto('ticket_events').values({ ticket_id: t.id, type: 'recall', user_id: u.id, data: null, created_at: now }).execute()
  await announce(ctx, t.id, true)
}

export const startServing = (ctx: Ctx, u: AuthUser) => transition(ctx, u, ['called'], { status: 'serving', started_at: nowIso() }, 'started')
export const finish = (ctx: Ctx, u: AuthUser) => transition(ctx, u, ['called', 'serving'], { status: 'done', finished_at: nowIso() }, 'finished')
export const markAbsent = (ctx: Ctx, u: AuthUser) => transition(ctx, u, ['called'], { status: 'absent', finished_at: nowIso() }, 'absent')

export async function transfer(ctx: Ctx, u: AuthUser, targetSectorId: number) {
  const target = await ctx.db.selectFrom('sectors').select(['id', 'name']).where('id', '=', targetSectorId).where('active', '=', 1).executeTakeFirst()
  if (!target) throw new HttpError(404, 'La secretaría de destino no existe')
  if (target.id === u.sectorId) throw new HttpError(400, 'Elegí otra secretaría')
  await transition(ctx, u, ['called', 'serving'], { status: 'waiting', sector_id: target.id, called_at: null, last_call_at: null, started_at: null, called_by: null, desk: null, desk_id: null, recall_count: 0 },
    'transferred', `-> ${target.name}`, [target.id])
}

type Row = { sector_id: number; status: string; priority: number; created_at: string; called_at: string | null; started_at: string | null; finished_at: string | null }

function summarize(rows: Row[]) {
  const waiting = rows.filter((r) => r.status === 'waiting')
  return {
    total: rows.length,
    waiting: waiting.length,
    active: rows.filter((r) => r.status === 'called' || r.status === 'serving').length,
    done: rows.filter((r) => r.status === 'done').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    avgWaitMin: avg(rows.map((r) => mins(r.created_at, r.called_at))),
    avgServiceMin: avg(rows.filter((r) => r.status === 'done').map((r) => mins(r.started_at, r.finished_at))),
    oldestWaitingMin: waiting.length ? Math.round(Math.max(...waiting.map((r) => mins(r.created_at, nowIso()) ?? 0))) : 0,
  }
}

const dayRows = (ctx: Ctx, from: string, to: string) =>
  ctx.db.selectFrom('tickets').select(['business_date', 'sector_id', 'status', 'priority', 'created_at', 'called_at', 'started_at', 'finished_at']).where('business_date', '>=', from).where('business_date', '<=', to).execute()

export async function deskState(ctx: Ctx, u: AuthUser) {
  const sid = needSector(u)
  const date = today(ctx)
  const settings = await getSettings(ctx)
  const sector = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).where('id', '=', sid).executeTakeFirstOrThrow()
  const waiting = await ctx.db.selectFrom('tickets').innerJoin('buttons', 'buttons.id', 'tickets.button_id')
    .leftJoin('priorities', 'priorities.id', 'tickets.priority_id')
    .leftJoin('patients', 'patients.id', 'tickets.patient_id')
    .select(['tickets.id', 'tickets.code', 'tickets.priority', 'tickets.created_at', 'buttons.label as button_label', 'priorities.name as priority_name', 'priorities.color as priority_color', 'patients.first_name', 'patients.last_name'])
    .where('tickets.sector_id', '=', sid).where('tickets.status', '=', 'waiting').where('tickets.business_date', '=', date)
    .orderBy('tickets.priority', 'desc').orderBy('tickets.created_at').orderBy('tickets.id').execute()
  const cur = await myCurrent(ctx, u)
  let current = null
  if (cur) {
    const b = await ctx.db.selectFrom('buttons').select('label').where('id', '=', cur.button_id).executeTakeFirst()
    const p = cur.patient_id
      ? await ctx.db.selectFrom('patients').select(['id', 'first_name', 'last_name', 'document_enc', 'document_type', 'visits', 'phone', 'notes', 'health_insurance', 'insurance_number']).where('id', '=', cur.patient_id).executeTakeFirst()
      : null
    current = {
      id: cur.id, code: cur.code, status: cur.status, createdAt: cur.created_at, calledAt: cur.called_at, startedAt: cur.started_at, recallCount: cur.recall_count, buttonLabel: b?.label ?? '', dni: cur.dni,
      // La secretaria atiende en persona: ve el documento descifrado para verificar la identidad
      patient: p
        ? { id: p.id, name: `${p.first_name} ${p.last_name}`, document: ctx.crypto.decrypt(p.document_enc) ?? '—', documentType: p.document_type, visits: p.visits, phone: p.phone, notes: p.notes, healthInsurance: p.health_insurance, insuranceNumber: p.insurance_number }
        : null,
    }
  }
  const stats = summarize((await dayRows(ctx, date, date)).filter((r) => r.sector_id === sid))
  const others = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).where('active', '=', 1).where('id', '!=', sid).orderBy('sort_order').orderBy('name').execute()
  const desks = await ctx.db.selectFrom('desks').select(['id', 'name', 'code']).where('sector_id', '=', sid).where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
  return {
    user: { displayName: u.displayName, desk: u.desk, deskId: u.deskId }, sector, current,
    waiting: waiting.map((w) => ({ id: w.id, code: w.code, priority: w.priority, priorityName: settings.priorities_enabled && w.priority > 0 ? w.priority_name : null, priorityColor: w.priority_color, createdAt: w.created_at, buttonLabel: w.button_label, patientName: w.first_name ? `${w.first_name} ${w.last_name}` : null })),
    stats, transferTargets: others, desks, serverTime: nowIso(),
    thresholds: { warn: settings.wait_warn_min, danger: settings.wait_danger_min },
  }
}

/** La secretaria elige en qué escritorio/box atiende hoy. */
export async function setDesk(ctx: Ctx, u: AuthUser, deskId: number | null) {
  const sid = needSector(u)
  if (await myCurrent(ctx, u)) throw new HttpError(409, 'Terminá el turno en curso antes de cambiar de puesto')
  if (deskId === null) {
    await ctx.db.updateTable('users').set({ desk_id: null }).where('id', '=', u.id).execute()
    u.deskId = null
    return
  }
  const d = await ctx.db.selectFrom('desks').select(['id', 'name']).where('id', '=', deskId).where('sector_id', '=', sid).where('active', '=', 1).executeTakeFirst()
  if (!d) throw new HttpError(404, 'Ese puesto no existe en tu secretaría')
  await ctx.db.updateTable('users').set({ desk_id: d.id, desk: d.name }).where('id', '=', u.id).execute()
  u.deskId = d.id
  u.desk = d.name
}

/** scope: secretarías visibles (supervisor) o null para todas. */
export async function overview(ctx: Ctx, scope: number[] | null = null) {
  const date = today(ctx)
  let sq = ctx.db.selectFrom('sectors').select(['id', 'name', 'color', 'site_id']).where('active', '=', 1)
  if (scope) sq = sq.where('id', 'in', scope.length ? scope : [0])
  const sectors = await sq.orderBy('sort_order').orderBy('name').execute()
  const rows = await dayRows(ctx, date, date)
  return { date, sectors: sectors.map((s) => ({ ...s, ...summarize(rows.filter((r) => r.sector_id === s.id)) })) }
}

export async function report(ctx: Ctx, from: string, to: string, scope: number[] | null = null) {
  const rows = (await dayRows(ctx, from, to)).filter((r) => !scope || scope.includes(r.sector_id))
  const sectors = (await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).orderBy('sort_order').orderBy('name').execute()).filter((x) => !scope || scope.includes(x.id))
  const days = [...new Set(rows.map((r) => r.business_date))].sort()
  return {
    from, to, totals: summarize(rows),
    bySector: sectors.map((s) => ({ ...s, ...summarize(rows.filter((r) => r.sector_id === s.id)) })).filter((s) => s.total > 0),
    byDay: days.map((d) => ({ date: d, ...summarize(rows.filter((r) => r.business_date === d)) })),
  }
}

export async function tvState(ctx: Ctx, sectorIds?: number[]) {
  const settings = await getSettings(ctx)
  const date = today(ctx)
  let q = ctx.db.selectFrom('tickets').innerJoin('sectors', 'sectors.id', 'tickets.sector_id')
    .select(['tickets.id', 'tickets.code', 'tickets.prefix', 'tickets.number', 'tickets.desk', 'tickets.last_call_at', 'tickets.sector_id', 'sectors.name as sector_name', 'sectors.color'])
    .where('tickets.business_date', '=', date).where('tickets.last_call_at', 'is not', null)
  if (sectorIds?.length) q = q.where('tickets.sector_id', 'in', sectorIds)
  const recent = await q.orderBy('tickets.last_call_at', 'desc').limit(12).execute()
  const sectors = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
  const counts = await ctx.db.selectFrom('tickets').select((eb) => ['sector_id', eb.fn.countAll<number>().as('n')])
    .where('business_date', '=', date).where('status', '=', 'waiting').groupBy('sector_id').execute()
  const visible = sectorIds?.length ? sectors.filter((s) => sectorIds.includes(s.id)) : sectors
  const uploaded = settings.tv_media_enabled
    ? (await ctx.db.selectFrom('media').select(['file_key', 'kind']).where('active', '=', 1).orderBy('sort_order').orderBy('id').execute()).map((m) => ({ url: `/api/public/media/${m.file_key}`, kind: m.kind }))
    : []
  const linked = mediaUrlList(settings).map((url) => ({ url, kind: /\.(mp4|webm|ogg)(\?|$)/i.test(url) ? 'video' : 'image' }))
  return {
    sectorIds: sectorIds ?? [],
    settings: {
      org_name: settings.org_name, brand_color: settings.brand_color,
      tv_voice_enabled: settings.tv_voice_enabled, tv_chime_enabled: settings.tv_chime_enabled, tv_voice_template: settings.tv_voice_template,
      tv_voice_rate: settings.tv_voice_rate, tv_chime_volume: settings.tv_chime_volume, tv_history_size: settings.tv_history_size,
      tv_media_enabled: settings.tv_media_enabled, tv_media: [...uploaded, ...linked].slice(0, 50), tv_media_interval_sec: settings.tv_media_interval_sec,
      tv_layout: settings.tv_layout, tv_ticker: settings.tv_ticker,
    },
    recent: recent.map((t) => ({ id: t.id, code: t.code, prefix: t.prefix, number: t.number, desk: t.desk, sectorId: t.sector_id, sectorName: t.sector_name, color: t.color, at: t.last_call_at })),
    waiting: visible.map((s) => ({ sectorId: s.id, name: s.name, color: s.color, count: Number(counts.find((c) => c.sector_id === s.id)?.n ?? 0) })),
  }
}

/**
 * Panel privado del turno (se abre con el QR del ticket). Se busca por un token aleatorio, no por el código,
 * para que nadie pueda ver los turnos de otros probando "A-001", "A-002"…
 */
export async function ticketStatus(ctx: Ctx, token: string) {
  const since = businessDate(ctx.cfg.timezone, new Date(Date.now() - 86400_000))
  const t = await ctx.db.selectFrom('tickets').innerJoin('sectors', 'sectors.id', 'tickets.sector_id').leftJoin('buttons', 'buttons.id', 'tickets.button_id')
    .select(['tickets.id', 'tickets.code', 'tickets.status', 'tickets.created_at', 'tickets.called_at', 'tickets.last_call_at', 'tickets.started_at', 'tickets.finished_at', 'tickets.desk', 'tickets.sector_id', 'tickets.priority', 'tickets.business_date',
      'sectors.name as sector_name', 'sectors.color as sector_color', 'buttons.label as button_label'])
    .where('tickets.public_token', '=', token).where('tickets.business_date', '>=', since).executeTakeFirst()
  if (!t) throw new HttpError(404, 'Turno no encontrado')
  let ahead = 0
  if (t.status === 'waiting') {
    const r = await ctx.db.selectFrom('tickets').select((eb) => eb.fn.countAll<number>().as('n'))
      .where('sector_id', '=', t.sector_id).where('business_date', '=', t.business_date).where('status', '=', 'waiting').where('id', '!=', t.id)
      .where((eb) => eb.or([eb('priority', '>', t.priority), eb.and([eb('priority', '=', t.priority), eb('created_at', '<=', t.created_at)])]))
      .executeTakeFirstOrThrow()
    ahead = Number(r.n)
  }
  const settings = await getSettings(ctx)
  const estimatedWaitMin = t.status === 'waiting' && settings.wait_estimate_enabled ? await estimateWait(ctx, t.sector_id, ahead) : null
  // Últimos llamados de su secretaría, para que el paciente vea cómo avanza la cola
  const lastCalls = await ctx.db.selectFrom('tickets').select(['code', 'desk', 'last_call_at'])
    .where('sector_id', '=', t.sector_id).where('business_date', '=', t.business_date).where('last_call_at', 'is not', null)
    .orderBy('last_call_at', 'desc').limit(4).execute()
  const logo = await ctx.db.selectFrom('assets').select('updated_at').where('asset_key', '=', 'logo').executeTakeFirst()
  return {
    code: t.code, status: t.status, sectorName: t.sector_name, sectorColor: t.sector_color, desk: t.desk, buttonLabel: t.button_label,
    waitingAhead: ahead, estimatedWaitMin, createdAt: t.created_at, calledAt: t.last_call_at ?? t.called_at, startedAt: t.started_at, finishedAt: t.finished_at,
    lastCalls: lastCalls.map((c) => ({ code: c.code, desk: c.desk, at: c.last_call_at })),
    orgName: settings.org_name, brandColor: settings.brand_color, logoVersion: logo?.updated_at ?? null,
  }
}

export async function closeStaleTickets(ctx: Ctx) {
  const r = await ctx.db.updateTable('tickets').set({ status: 'cancelled', finished_at: nowIso() }).where('business_date', '<', today(ctx)).where('status', 'in', ['waiting', 'called', 'serving']).executeTakeFirst()
  return Number(r.numUpdatedRows)
}
