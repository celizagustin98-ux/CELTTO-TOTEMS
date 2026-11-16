import type { Ctx } from './db.js'
import { businessDate } from './db.js'

const mins = (a?: string | null, b?: string | null) =>
  a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : null
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && x >= 0)
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null
}

export async function detailedReport(ctx: Ctx, from: string, to: string) {
  const tickets = await ctx.db
    .selectFrom('tickets')
    .innerJoin('sectors', 'sectors.id', 'tickets.sector_id')
    .innerJoin('buttons', 'buttons.id', 'tickets.button_id')
    .select([
      'tickets.id',
      'tickets.code',
      'tickets.status',
      'tickets.priority',
      'tickets.created_at',
      'tickets.called_at',
      'tickets.started_at',
      'tickets.finished_at',
      'tickets.desk',
      'tickets.recall_count',
      'tickets.business_date',
      'tickets.sector_id',
      'sectors.name as sector_name',
      'sectors.color as sector_color',
      'buttons.label as button_label',
      'buttons.prefix',
    ])
    .where('tickets.business_date', '>=', from)
    .where('tickets.business_date', '<=', to)
    .orderBy('tickets.id', 'asc')
    .execute()

  const byStatus: Record<string, number> = {}
  const bySector: Record<string, { name: string; color: string; total: number; done: number; absent: number; waitTimes: (number | null)[]; serviceTimes: (number | null)[] }> = {}
  const byHour: Record<string, number> = {}
  const byDay: Record<string, number> = {}
  const byPrefix: Record<string, number> = {}

  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
    byDay[t.business_date] = (byDay[t.business_date] ?? 0) + 1
    byPrefix[t.prefix] = (byPrefix[t.prefix] ?? 0) + 1
    const hour = (t.created_at || '').slice(11, 13) || '??'
    byHour[hour] = (byHour[hour] ?? 0) + 1
    const key = String(t.sector_id)
    if (!bySector[key]) {
      bySector[key] = {
        name: t.sector_name,
        color: t.sector_color,
        total: 0,
        done: 0,
        absent: 0,
        waitTimes: [],
        serviceTimes: [],
      }
    }
    const s = bySector[key]
    s.total++
    if (t.status === 'done') s.done++
    if (t.status === 'absent') s.absent++
    s.waitTimes.push(mins(t.created_at, t.called_at ?? t.started_at))
    s.serviceTimes.push(mins(t.started_at, t.finished_at))
  }

  const sectors = Object.entries(bySector).map(([id, s]) => ({
    sectorId: Number(id),
    name: s.name,
    color: s.color,
    total: s.total,
    done: s.done,
    absent: s.absent,
    avgWaitMin: avg(s.waitTimes),
    avgServiceMin: avg(s.serviceTimes),
  }))

  const waitAll = tickets.map((t) => mins(t.created_at, t.called_at ?? t.started_at))
  const serviceAll = tickets.map((t) => mins(t.started_at, t.finished_at))

  return {
    from,
    to,
    total: tickets.length,
    byStatus,
    byHour: Object.entries(byHour)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, count]) => ({ hour, count })),
    byDay: Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
    byPrefix: Object.entries(byPrefix).map(([prefix, count]) => ({ prefix, count })),
    sectors,
    avgWaitMin: avg(waitAll),
    avgServiceMin: avg(serviceAll),
    maxWaitMin: Math.max(0, ...waitAll.filter((x): x is number => x != null)),
    tickets: tickets.map((t) => ({
      id: t.id,
      code: t.code,
      status: t.status,
      priority: t.priority,
      sectorName: t.sector_name,
      buttonLabel: t.button_label,
      desk: t.desk,
      createdAt: t.created_at,
      calledAt: t.called_at,
      finishedAt: t.finished_at,
      waitMin: mins(t.created_at, t.called_at ?? t.started_at),
      serviceMin: mins(t.started_at, t.finished_at),
      recalls: t.recall_count,
      date: t.business_date,
    })),
  }
}

export async function overviewStats(ctx: Ctx) {
  const date = businessDate(ctx.cfg.timezone)
  const report = await detailedReport(ctx, date, date)
  const waiting = await ctx.db
    .selectFrom('tickets')
    .select(({ fn }) => [fn.countAll<number>().as('c')])
    .where('business_date', '=', date)
    .where('status', 'in', ['waiting', 'called', 'serving'])
    .executeTakeFirst()
  return {
    date,
    openQueue: Number(waiting?.c ?? 0),
    ...report,
  }
}
