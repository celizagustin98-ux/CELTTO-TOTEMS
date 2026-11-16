import type { Ctx } from './db.js'
import { businessDate, insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { getSettings } from './settings.js'
import type { AuthUser } from './types.js'

const today = (ctx: Ctx) => businessDate(ctx.cfg.timezone)
const mins = (a?: string | null, b?: string | null) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : null)
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null && x >= 0); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null }

async function nextNumber(trx: any, key: string): Promise<number> {
  for (let i = 0; i < 3; i++) {
    const r = await trx.updateTable('counters').set((eb: any) => ({ counter_value: eb('counter_value', '+', 1) })).where('counter_key', '=', key).executeTakeFirst()
    if (Number(r.numUpdatedRows) > 0) break
    try { await trx.insertInto('counters').values({ counter_key: key, counter_value: 0 }).execute() } catch {  }
  }
  const row = await trx.selectFrom('counters').select('counter_value').where('counter_key', '=', key).executeTakeFirstOrThrow()
  return Number(row.counter_value)
}

export async function createTicket(ctx: Ctx, buttonId: number) {
  const btn = await ctx.db.selectFrom('buttons').selectAll().where('id', '=', buttonId).where('active', '=', 1).executeTakeFirst()
  if (!btn) throw new HttpError(404, 'Este botón no está disponible')
  const sector = await ctx.db.selectFrom('sectors').selectAll().where('id', '=', btn.target_sector_id).where('active', '=', 1).executeTakeFirst()
  if (!sector) throw new HttpError(409, 'La cola de este botón no está activa')
  const date = today(ctx)
  const now = nowIso()
  const t = await ctx.db.transaction().execute(async (trx) => {
    const n = await nextNumber(trx, `${date}|${btn.prefix}`)
    const code = `${btn.prefix}-${String(n).padStart(3, '0')}`
    const id = await insertId(ctx, trx, 'tickets', {
      code, prefix: btn.prefix, number: n, business_date: date, button_id: btn.id, sector_id: sector.id, origin_sector_id: btn.sector_id,
      priority: btn.priority, status: 'waiting', created_at: now, called_at: null, last_call_at: null, started_at: null, finished_at: null,
      called_by: null, desk: null, recall_count: 0,
    })
    await trx.insertInto('ticket_events').values({ ticket_id: id, type: 'created', user_id: null, data: null, created_at: now }).execute()
    return { id, code, number: n }
  })
  const ahead = await ctx.db.selectFrom('tickets').select((eb) => eb.fn.countAll<number>().as('n'))
    .where('sector_id', '=', sector.id).where('status', '=', 'waiting').where('business_date', '=', date).where('id', '!=', t.id)
    .where((eb) => eb.or([eb('priority', '>', btn.priority), eb.and([eb('priority', '=', btn.priority), eb('created_at', '<=', now)])]))
    .executeTakeFirstOrThrow()
  ctx.hub.broadcast({ type: 'queue', sectorIds: [sector.id] })
  return { id: t.id, code: t.code, label: btn.label, sectorName: sector.name, color: btn.color ?? sector.color, waitingAhead: Number(ahead.n), createdAt: now }
}

async function announce(ctx: Ctx, ticketId: number, recall: boolean) {
  const t = await ctx.db.selectFrom('tickets').innerJoin('sectors', 'sectors.id', 'tickets.sector_id')
    .select(['tickets.id', 'tickets.code', 'tickets.prefix', 'tickets.number', 'tickets.desk', 'tickets.sector_id', 'sectors.name as sector_name', 'sectors.color'])
    .where('tickets.id', '=', ticketId).executeTakeFirst()
  if (!t) return
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
  for (let i = 0; i < 5; i++) {
    const id = await pick()
    if (id === undefined) throw new HttpError(404, 'No hay turnos en espera')
    const now = nowIso()
    const r = await ctx.db.updateTable('tickets').set({ status: 'called', called_at: now, last_call_at: now, called_by: u.id, desk: u.desk, recall_count: 0 })
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
  await transition(ctx, u, ['called', 'serving'], { status: 'waiting', sector_id: target.id, called_at: null, last_call_at: null, started_at: null, called_by: null, desk: null, recall_count: 0 },
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
    oldestWaitingMin: waiting.length ? Math.max(...waiting.map((r) => mins(r.created_at, nowIso()) ?? 0)) : 0,
  }
}

const dayRows = (ctx: Ctx, from: string, to: string) =>
  ctx.db.selectFrom('tickets').select(['business_date', 'sector_id', 'status', 'priority', 'created_at', 'called_at', 'started_at', 'finished_at']).where('business_date', '>=', from).where('business_date', '<=', to).execute()

export async function deskState(ctx: Ctx, u: AuthUser) {
  const sid = needSector(u)
  const date = today(ctx)
  const sector = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).where('id', '=', sid).executeTakeFirstOrThrow()
  const waiting = await ctx.db.selectFrom('tickets').innerJoin('buttons', 'buttons.id', 'tickets.button_id')
    .select(['tickets.id', 'tickets.code', 'tickets.priority', 'tickets.created_at', 'buttons.label as button_label'])
    .where('tickets.sector_id', '=', sid).where('tickets.status', '=', 'waiting').where('tickets.business_date', '=', date)
    .orderBy('tickets.priority', 'desc').orderBy('tickets.created_at').orderBy('tickets.id').execute()
  const cur = await myCurrent(ctx, u)
  let current = null
  if (cur) {
    const b = await ctx.db.selectFrom('buttons').select('label').where('id', '=', cur.button_id).executeTakeFirst()
    current = { id: cur.id, code: cur.code, status: cur.status, createdAt: cur.created_at, calledAt: cur.called_at, startedAt: cur.started_at, recallCount: cur.recall_count, buttonLabel: b?.label ?? '' }
  }
  const stats = summarize((await dayRows(ctx, date, date)).filter((r) => r.sector_id === sid))
  const others = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).where('active', '=', 1).where('id', '!=', sid).orderBy('sort_order').orderBy('name').execute()
  return {
    user: { displayName: u.displayName, desk: u.desk }, sector, current,
    waiting: waiting.map((w) => ({ id: w.id, code: w.code, priority: w.priority, createdAt: w.created_at, buttonLabel: w.button_label })),
    stats, transferTargets: others, serverTime: nowIso(),
  }
}

export async function overview(ctx: Ctx) {
  const date = today(ctx)
  const sectors = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
  const rows = await dayRows(ctx, date, date)
  return { date, sectors: sectors.map((s) => ({ ...s, ...summarize(rows.filter((r) => r.sector_id === s.id)) })) }
}

export async function report(ctx: Ctx, from: string, to: string) {
  const rows = await dayRows(ctx, from, to)
  const sectors = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color']).orderBy('sort_order').orderBy('name').execute()
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
  const rows = (await dayRows(ctx, date, date)).filter((r) => r.status === 'waiting')
  const visible = sectorIds?.length ? sectors.filter((s) => sectorIds.includes(s.id)) : sectors
  return {
    settings: { org_name: settings.org_name, tv_voice_enabled: settings.tv_voice_enabled, tv_chime_enabled: settings.tv_chime_enabled, tv_voice_template: settings.tv_voice_template, tv_voice_rate: settings.tv_voice_rate, tv_chime_volume: settings.tv_chime_volume, tv_history_size: settings.tv_history_size },
    recent: recent.map((t) => ({ id: t.id, code: t.code, prefix: t.prefix, number: t.number, desk: t.desk, sectorId: t.sector_id, sectorName: t.sector_name, color: t.color, at: t.last_call_at })),
    waiting: visible.map((s) => ({ sectorId: s.id, name: s.name, color: s.color, count: rows.filter((r) => r.sector_id === s.id).length })),
  }
}

export async function closeStaleTickets(ctx: Ctx) {
  const r = await ctx.db.updateTable('tickets').set({ status: 'cancelled', finished_at: nowIso() }).where('business_date', '<', today(ctx)).where('status', 'in', ['waiting', 'called', 'serving']).executeTakeFirst()
  return Number(r.numUpdatedRows)
}
