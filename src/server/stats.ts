import type { Ctx } from './db.js'
import { businessDate, nowIso } from './db.js'

/**
 * Resúmenes diarios (tabla daily_stats) y productividad.
 * - Los días cerrados se resumen una vez: los reportes de meses/años leen pocas filas en vez de millones de turnos.
 * - El día de hoy se calcula en vivo con la misma función, así los números coinciden.
 */
type T = {
  business_date: string
  sector_id: number
  called_by: number | null
  status: string
  created_at: string
  called_at: string | null
  started_at: string | null
  finished_at: string | null
  recall_count: number
}
type Agg = {
  business_date: string
  site_id: number | null
  sector_id: number
  user_id: number
  issued: number
  called: number
  done: number
  absent: number
  cancelled: number
  transferred: number
  recalls: number
  wait_sum_sec: number
  wait_count: number
  wait_max_sec: number
  service_sum_sec: number
  service_count: number
  first_call_at: string | null
  last_finish_at: string | null
}
const secs = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null)
const empty = (date: string, sector: number, user: number, site: number | null): Agg => ({
  business_date: date, site_id: site, sector_id: sector, user_id: user, issued: 0, called: 0, done: 0, absent: 0, cancelled: 0, transferred: 0, recalls: 0,
  wait_sum_sec: 0, wait_count: 0, wait_max_sec: 0, service_sum_sec: 0, service_count: 0, first_call_at: null, last_finish_at: null,
})

async function ticketsOfDay(ctx: Ctx, date: string): Promise<T[]> {
  const cols = ['business_date', 'sector_id', 'called_by', 'status', 'created_at', 'called_at', 'started_at', 'finished_at', 'recall_count'] as const
  const live = await ctx.db.selectFrom('tickets').select([...cols]).where('business_date', '=', date).execute()
  const arch = await ctx.db.selectFrom('tickets_archive').select([...cols]).where('business_date', '=', date).execute()
  return [...live, ...arch] as T[]
}

async function transfersOfDay(ctx: Ctx, date: string) {
  const from = `${date}T00:00:00.000Z`
  const to = new Date(Date.parse(from) + 2 * 86400_000).toISOString()
  // Margen de un día por la zona horaria; se filtra por la fecha de negocio del turno
  const rows = await ctx.db
    .selectFrom('ticket_events')
    .innerJoin('tickets', 'tickets.id', 'ticket_events.ticket_id')
    .select(['ticket_events.user_id', 'tickets.origin_sector_id', 'tickets.business_date'])
    .where('ticket_events.type', '=', 'transferred')
    .where('ticket_events.created_at', '>=', new Date(Date.parse(from) - 86400_000).toISOString())
    .where('ticket_events.created_at', '<', to)
    .execute()
  return rows.filter((r) => r.business_date === date)
}

/** Calcula los resúmenes de un día (sin guardar). */
export async function computeDay(ctx: Ctx, date: string) {
  const tickets = await ticketsOfDay(ctx, date)
  const transfers = await transfersOfDay(ctx, date)
  const sites = new Map((await ctx.db.selectFrom('sectors').select(['id', 'site_id']).execute()).map((s) => [s.id, s.site_id]))
  const map = new Map<string, Agg>()
  const get = (sector: number, user: number) => {
    const k = `${sector}|${user}`
    let a = map.get(k)
    if (!a) map.set(k, (a = empty(date, sector, user, sites.get(sector) ?? null)))
    return a
  }
  const add = (a: Agg, t: T) => {
    if (t.called_at) a.called++
    if (t.status === 'done') a.done++
    if (t.status === 'absent') a.absent++
    if (t.status === 'cancelled') a.cancelled++
    a.recalls += t.recall_count ?? 0
    const w = secs(t.created_at, t.called_at)
    if (w != null) {
      a.wait_sum_sec += w
      a.wait_count++
      a.wait_max_sec = Math.max(a.wait_max_sec, w)
    }
    const sv = t.status === 'done' ? secs(t.started_at ?? t.called_at, t.finished_at) : null
    if (sv != null) {
      a.service_sum_sec += sv
      a.service_count++
    }
    if (t.called_at && (!a.first_call_at || t.called_at < a.first_call_at)) a.first_call_at = t.called_at
    if (t.finished_at && t.status !== 'cancelled' && (!a.last_finish_at || t.finished_at > a.last_finish_at)) a.last_finish_at = t.finished_at
  }
  const hourly = new Map<string, { sector_id: number; hour: number; weekday: number; issued: number }>()
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: ctx.cfg.timezone, hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  for (const t of tickets) {
    const s = get(t.sector_id, 0)
    s.issued++
    add(s, t)
    if (t.called_by) add(get(t.sector_id, t.called_by), t)
    const parts = Object.fromEntries(fmt.formatToParts(new Date(t.created_at)).map((p) => [p.type, p.value]))
    const hour = Number(parts.hour)
    const k = `${t.sector_id}|${hour}`
    const h = hourly.get(k) ?? { sector_id: t.sector_id, hour, weekday: WD[parts.weekday] ?? 0, issued: 0 }
    h.issued++
    hourly.set(k, h)
  }
  for (const tr of transfers) {
    get(tr.origin_sector_id, 0).transferred++
    if (tr.user_id) get(tr.origin_sector_id, tr.user_id).transferred++
  }
  return { rows: [...map.values()], hourly: [...hourly.values()] }
}

/** Guarda (o recalcula) los resúmenes de un día. */
export async function persistDay(ctx: Ctx, date: string) {
  const { rows, hourly } = await computeDay(ctx, date)
  await ctx.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('daily_stats').where('business_date', '=', date).execute()
    await trx.deleteFrom('hourly_stats').where('business_date', '=', date).execute()
    const now = nowIso()
    for (const r of rows) await trx.insertInto('daily_stats').values({ ...r, computed_at: now }).execute()
    for (const h of hourly) await trx.insertInto('hourly_stats').values({ business_date: date, ...h }).execute()
  })
  return rows.length
}

/** Resume los días anteriores que todavía no tienen resumen (máximo 400 días por pasada). */
export async function ensureStats(ctx: Ctx) {
  const today = businessDate(ctx.cfg.timezone)
  const withTickets = await ctx.db.selectFrom('tickets').select('business_date').distinct().where('business_date', '<', today).execute()
  const done = new Set((await ctx.db.selectFrom('daily_stats').select('business_date').distinct().execute()).map((r) => r.business_date))
  const missing = withTickets.map((r) => r.business_date).filter((d) => !done.has(d)).sort().slice(-400)
  for (const d of missing) await persistDay(ctx, d)
  return missing.length
}

/**
 * Archivo histórico: los turnos con más de N meses pasan a tickets_archive / ticket_events_archive.
 * Antes se asegura su resumen, así las estadísticas no cambian.
 */
export async function archiveOld(ctx: Ctx, months: number) {
  if (!months || months < 3) return 0
  const cut = new Date()
  cut.setMonth(cut.getMonth() - months)
  const cutoff = businessDate(ctx.cfg.timezone, cut)
  await ensureStats(ctx)
  let moved = 0
  for (;;) {
    const batch = await ctx.db.selectFrom('tickets').selectAll().where('business_date', '<', cutoff).orderBy('id').limit(500).execute()
    if (!batch.length) break
    const ids = batch.map((t) => t.id)
    await ctx.db.transaction().execute(async (trx) => {
      const now = nowIso()
      for (const t of batch)
        await trx.insertInto('tickets_archive').values({
          id: t.id, code: t.code, business_date: t.business_date, button_id: t.button_id, sector_id: t.sector_id, origin_sector_id: t.origin_sector_id, priority: t.priority,
          status: t.status, created_at: t.created_at, called_at: t.called_at, started_at: t.started_at, finished_at: t.finished_at, called_by: t.called_by, desk: t.desk,
          recall_count: t.recall_count, patient_id: t.patient_id, archived_at: now,
        }).execute()
      const evs = await trx.selectFrom('ticket_events').selectAll().where('ticket_id', 'in', ids).execute()
      for (const e of evs) await trx.insertInto('ticket_events_archive').values({ id: e.id, ticket_id: e.ticket_id, type: e.type, user_id: e.user_id, data: e.data, created_at: e.created_at }).execute()
      await trx.deleteFrom('ticket_events').where('ticket_id', 'in', ids).execute()
      await trx.deleteFrom('tickets').where('id', 'in', ids).execute()
    })
    moved += batch.length
  }
  return moved
}

const avgMin = (sum: number, n: number) => (n ? Math.round((sum / n / 60) * 10) / 10 : null)

/** Productividad por usuario, secretaría y día + mapa de calor (día de la semana × hora). */
export async function productivity(ctx: Ctx, from: string, to: string, scope: number[] | null) {
  const today = businessDate(ctx.cfg.timezone)
  let q = ctx.db.selectFrom('daily_stats').selectAll().where('business_date', '>=', from).where('business_date', '<=', to).where('business_date', '<', today)
  if (scope) q = q.where('sector_id', 'in', scope.length ? scope : [0])
  const rows: Agg[] = await q.execute()
  let hq = ctx.db.selectFrom('hourly_stats').selectAll().where('business_date', '>=', from).where('business_date', '<=', to).where('business_date', '<', today)
  if (scope) hq = hq.where('sector_id', 'in', scope.length ? scope : [0])
  const hourly = await hq.execute()
  if (from <= today && today <= to) {
    const live = await computeDay(ctx, today)
    rows.push(...live.rows.filter((r) => !scope || scope.includes(r.sector_id)))
    hourly.push(...live.hourly.filter((h) => !scope || scope.includes(h.sector_id)).map((h) => ({ business_date: today, ...h })))
  }
  const users = await ctx.db.selectFrom('users').select(['id', 'display_name', 'role', 'active']).execute()
  const sectors = await ctx.db.selectFrom('sectors').select(['id', 'name', 'color', 'site_id']).execute()

  const sum = (list: Agg[]) =>
    list.reduce(
      (a, r) => {
        for (const k of ['issued', 'called', 'done', 'absent', 'cancelled', 'transferred', 'recalls', 'wait_sum_sec', 'wait_count', 'service_sum_sec', 'service_count'] as const) a[k] += r[k]
        a.wait_max_sec = Math.max(a.wait_max_sec, r.wait_max_sec)
        return a
      },
      empty('', 0, 0, null),
    )
  const activeHours = (list: Agg[]) => list.reduce((h, r) => h + (r.first_call_at && r.last_finish_at ? Math.max(0, Date.parse(r.last_finish_at) - Date.parse(r.first_call_at)) / 3_600_000 : 0), 0)

  const userRows = rows.filter((r) => r.user_id > 0)
  const byUser = [...new Set(userRows.map((r) => r.user_id))].map((uid) => {
    const list = userRows.filter((r) => r.user_id === uid)
    const s = sum(list)
    const hours = activeHours(list)
    const u = users.find((x) => x.id === uid)
    return {
      userId: uid,
      name: u?.display_name ?? `Usuario #${uid}`,
      active: u?.active === 1,
      sectors: [...new Set(list.map((r) => sectors.find((x) => x.id === r.sector_id)?.name).filter(Boolean))],
      days: new Set(list.map((r) => r.business_date)).size,
      called: s.called,
      done: s.done,
      absent: s.absent,
      transferred: s.transferred,
      recalls: s.recalls,
      avgServiceMin: avgMin(s.service_sum_sec, s.service_count),
      avgWaitMin: avgMin(s.wait_sum_sec, s.wait_count),
      activeHours: Math.round(hours * 10) / 10,
      perHour: hours > 0.25 ? Math.round((s.done / hours) * 10) / 10 : null,
      absentRate: s.done + s.absent ? Math.round((s.absent / (s.done + s.absent)) * 100) : null,
    }
  }).sort((a, b) => b.done - a.done)

  const sectorRows = rows.filter((r) => r.user_id === 0)
  const bySector = [...new Set(sectorRows.map((r) => r.sector_id))].map((sid) => {
    const s = sum(sectorRows.filter((r) => r.sector_id === sid))
    const sec = sectors.find((x) => x.id === sid)
    return {
      sectorId: sid, name: sec?.name ?? `#${sid}`, color: sec?.color ?? '#64748b', siteId: sec?.site_id ?? null,
      issued: s.issued, done: s.done, absent: s.absent, cancelled: s.cancelled, transferred: s.transferred,
      avgWaitMin: avgMin(s.wait_sum_sec, s.wait_count), maxWaitMin: Math.round(s.wait_max_sec / 6) / 10, avgServiceMin: avgMin(s.service_sum_sec, s.service_count),
      attendRate: s.issued ? Math.round((s.done / s.issued) * 100) : null,
    }
  }).sort((a, b) => b.issued - a.issued)

  const byDay = [...new Set(sectorRows.map((r) => r.business_date))].sort().map((d) => {
    const s = sum(sectorRows.filter((r) => r.business_date === d))
    return { date: d, issued: s.issued, done: s.done, absent: s.absent, avgWaitMin: avgMin(s.wait_sum_sec, s.wait_count), avgServiceMin: avgMin(s.service_sum_sec, s.service_count) }
  })

  const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const h of hourly) heat[h.weekday][h.hour] += h.issued

  const t = sum(sectorRows)
  return {
    from, to,
    totals: {
      issued: t.issued, done: t.done, absent: t.absent, cancelled: t.cancelled, transferred: t.transferred,
      avgWaitMin: avgMin(t.wait_sum_sec, t.wait_count), maxWaitMin: Math.round(t.wait_max_sec / 6) / 10, avgServiceMin: avgMin(t.service_sum_sec, t.service_count),
      attendRate: t.issued ? Math.round((t.done / t.issued) * 100) : null,
    },
    users: byUser,
    sectors: bySector,
    days: byDay,
    heatmap: heat,
  }
}
