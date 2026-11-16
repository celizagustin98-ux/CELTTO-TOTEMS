import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireRole } from './auth.js'
import type { Ctx } from './db.js'
import { businessDate, insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { overview, report } from './queue.js'
import { hashPassword } from './security.js'
import { getSettings, saveSettings, settingsPatch } from './settings.js'
import { audit } from './audit.js'
import { detailedReport } from './reports.js'

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido')
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const sectorBody = z.object({ name: z.string().trim().min(1).max(100), color, welcomeMessage: z.string().trim().max(200).nullish(), sortOrder: z.number().int().min(0).max(999).optional() })
const buttonBody = z.object({
  sectorId: z.number().int().positive(), targetSectorId: z.number().int().positive().optional(),
  label: z.string().trim().min(1).max(100), subtitle: z.string().trim().max(160).nullish(), color: color.nullish(),
  prefix: z.string().trim().regex(/^[A-Za-z0-9]{1,3}$/, 'El prefijo debe tener de 1 a 3 letras o números').transform((s) => s.toUpperCase()),
  priority: z.number().int().min(0).max(9).default(0), priorityId: z.number().int().positive().nullish(), sortOrder: z.number().int().min(0).max(999).optional(),
})
const userCreate = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Usuario: 3 a 40 caracteres (letras, números, punto, guion)'),
  displayName: z.string().trim().min(1).max(100), password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
  sectorId: z.number().int().positive(), desk: z.string().trim().max(60).nullish(),
})
const userUpdate = z.object({ displayName: z.string().trim().min(1).max(100), sectorId: z.number().int().positive(), desk: z.string().trim().max(60).nullish(), active: z.boolean(), password: z.string().min(8).max(200).optional() }).partial()
const idParam = (req: any) => z.coerce.number().int().positive().parse(req.params.id)

export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const pre = { preHandler: requireRole(ctx, 'owner') }
  const sectorExists = async (id: number) => { if (!(await ctx.db.selectFrom('sectors').select('id').where('id', '=', id).where('active', '=', 1).executeTakeFirst())) throw new HttpError(404, 'La secretaría no existe') }

  
  app.get('/api/admin/sectors', pre, async () => {
    const sectors = await ctx.db.selectFrom('sectors').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
    const buttons = await ctx.db.selectFrom('buttons').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('id').execute()
    return sectors.map((s) => ({
      id: s.id, name: s.name, color: s.color, welcomeMessage: s.welcome_message, sortOrder: s.sort_order,
      buttons: buttons.filter((b) => b.sector_id === s.id).map((b) => ({ id: b.id, sectorId: b.sector_id, targetSectorId: b.target_sector_id, label: b.label, subtitle: b.subtitle, color: b.color, prefix: b.prefix, priority: b.priority, priorityId: (b as any).priority_id, sortOrder: b.sort_order })),
    }))
  })

  app.post('/api/admin/sectors', pre, async (req) => {
    const b = sectorBody.parse(req.body)
    const id = await insertId(ctx, ctx.db, 'sectors', { name: b.name, color: b.color, welcome_message: b.welcomeMessage || null, sort_order: b.sortOrder ?? 0, active: 1, created_at: nowIso() })
    ctx.hub.broadcast({ type: 'config' })
    return { id }
  })

  app.put('/api/admin/sectors/:id', pre, async (req) => {
    const id = idParam(req); const b = sectorBody.parse(req.body)
    await sectorExists(id)
    await ctx.db.updateTable('sectors').set({ name: b.name, color: b.color, welcome_message: b.welcomeMessage || null, sort_order: b.sortOrder ?? 0 }).where('id', '=', id).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.delete('/api/admin/sectors/:id', pre, async (req) => {
    const id = idParam(req)
    await sectorExists(id)
    const waiting = await ctx.db.selectFrom('tickets').select((eb) => eb.fn.countAll<number>().as('n')).where('sector_id', '=', id).where('business_date', '=', businessDate(ctx.cfg.timezone)).where('status', 'in', ['waiting', 'called', 'serving']).executeTakeFirstOrThrow()
    if (Number(waiting.n) > 0) throw new HttpError(409, 'La secretaría tiene turnos en curso. Atendelos o cancelalos antes de eliminarla.')
    const incoming = await ctx.db.selectFrom('buttons').select('label').where('target_sector_id', '=', id).where('sector_id', '!=', id).where('active', '=', 1).executeTakeFirst()
    if (incoming) throw new HttpError(409, `El botón "${incoming.label}" de otra secretaría genera turnos para esta. Cambialo antes de eliminarla.`)
    await ctx.db.updateTable('buttons').set({ active: 0 }).where('sector_id', '=', id).execute()
    await ctx.db.updateTable('users').set({ sector_id: null }).where('sector_id', '=', id).where('role', '=', 'secretary').execute()
    await ctx.db.updateTable('sectors').set({ active: 0 }).where('id', '=', id).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.post('/api/admin/buttons', pre, async (req) => {
    const b = buttonBody.parse(req.body)
    await sectorExists(b.sectorId); await sectorExists(b.targetSectorId ?? b.sectorId)
    const id = await insertId(ctx, ctx.db, 'buttons', { sector_id: b.sectorId, target_sector_id: b.targetSectorId ?? b.sectorId, label: b.label, subtitle: b.subtitle || null, color: b.color || null, prefix: b.prefix, priority: b.priority, priority_id: b.priorityId ?? null, sort_order: b.sortOrder ?? 0, active: 1 })
    ctx.hub.broadcast({ type: 'config' })
    return { id }
  })

  app.put('/api/admin/buttons/:id', pre, async (req) => {
    const id = idParam(req); const b = buttonBody.parse(req.body)
    await sectorExists(b.sectorId); await sectorExists(b.targetSectorId ?? b.sectorId)
    const r = await ctx.db.updateTable('buttons').set({ sector_id: b.sectorId, target_sector_id: b.targetSectorId ?? b.sectorId, label: b.label, subtitle: b.subtitle || null, color: b.color || null, prefix: b.prefix, priority: b.priority, priority_id: b.priorityId ?? null, sort_order: b.sortOrder ?? 0 }).where('id', '=', id).where('active', '=', 1).executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) throw new HttpError(404, 'El botón no existe')
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.delete('/api/admin/buttons/:id', pre, async (req) => {
    const r = await ctx.db.updateTable('buttons').set({ active: 0 }).where('id', '=', idParam(req)).executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) throw new HttpError(404, 'El botón no existe')
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  
  app.get('/api/admin/users', pre, async () => {
    const rows = await ctx.db.selectFrom('users').leftJoin('sectors', 'sectors.id', 'users.sector_id')
      .select(['users.id', 'users.username', 'users.display_name', 'users.sector_id', 'users.desk', 'users.active', 'sectors.name as sector_name'])
      .where('users.role', '=', 'secretary').orderBy('users.display_name').execute()
    return rows.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, sectorId: u.sector_id, sectorName: u.sector_name, desk: u.desk, active: u.active === 1 }))
  })

  app.post('/api/admin/users', pre, async (req) => {
    const b = userCreate.parse(req.body)
    await sectorExists(b.sectorId)
    if (await ctx.db.selectFrom('users').select('id').where('username', '=', b.username).executeTakeFirst()) throw new HttpError(409, 'Ese nombre de usuario ya existe')
    const id = await insertId(ctx, ctx.db, 'users', { username: b.username, display_name: b.displayName, password_hash: await hashPassword(b.password), role: 'secretary', sector_id: b.sectorId, desk: b.desk || null, active: 1, created_at: nowIso() })
    return { id }
  })

  app.put('/api/admin/users/:id', pre, async (req) => {
    const id = idParam(req); const b = userUpdate.parse(req.body)
    const u = await ctx.db.selectFrom('users').select(['id']).where('id', '=', id).where('role', '=', 'secretary').executeTakeFirst()
    if (!u) throw new HttpError(404, 'El usuario no existe')
    if (b.sectorId) await sectorExists(b.sectorId)
    const set: Record<string, unknown> = {}
    if (b.displayName !== undefined) set.display_name = b.displayName
    if (b.sectorId !== undefined) set.sector_id = b.sectorId
    if (b.desk !== undefined) set.desk = b.desk || null
    if (b.active !== undefined) set.active = b.active ? 1 : 0
    if (b.password) set.password_hash = await hashPassword(b.password)
    if (Object.keys(set).length) await ctx.db.updateTable('users').set(set as any).where('id', '=', id).execute()
    if (b.active === false || b.password) await ctx.db.deleteFrom('sessions').where('user_id', '=', id).execute()
    return { ok: true }
  })

  
  app.get('/api/admin/settings', pre, async () => getSettings(ctx))
  app.put('/api/admin/settings', pre, async (req) => {
    await saveSettings(ctx, settingsPatch.parse(req.body))
    ctx.hub.broadcast({ type: 'config' })
    return getSettings(ctx)
  })

  app.get('/api/admin/overview', pre, async () => overview(ctx))

  app.get('/api/admin/reports', pre, async (req) => {
    const t = businessDate(ctx.cfg.timezone)
    const qy = req.query as any
    const from = dateStr.parse(qy.from ?? t), to = dateStr.parse(qy.to ?? t)
    if (from > to) throw new HttpError(400, 'La fecha "desde" no puede ser posterior a "hasta"')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) throw new HttpError(400, 'El rango máximo es de 92 días')
    return report(ctx, from, to)
  })

  app.get('/api/admin/tickets', pre, async (req) => {
    const qy = req.query as any
    const date = dateStr.parse(qy.date ?? businessDate(ctx.cfg.timezone))
    const rows = await ctx.db.selectFrom('tickets').innerJoin('sectors', 'sectors.id', 'tickets.sector_id').innerJoin('buttons', 'buttons.id', 'tickets.button_id')
      .select(['tickets.id', 'tickets.code', 'tickets.status', 'tickets.created_at', 'tickets.called_at', 'tickets.finished_at', 'tickets.desk', 'sectors.name as sector_name', 'buttons.label'])
      .where('tickets.business_date', '=', date).orderBy('tickets.id', 'desc').limit(500).execute()
    return rows.map((r) => ({ id: r.id, code: r.code, status: r.status, sectorName: r.sector_name, label: r.label, createdAt: r.created_at, calledAt: r.called_at, finishedAt: r.finished_at, desk: r.desk }))
  })

  app.post('/api/admin/tickets/:id/cancel', pre, async (req) => {
    const id = idParam(req)
    const t = await ctx.db.selectFrom('tickets').select(['id', 'sector_id']).where('id', '=', id).where('status', 'in', ['waiting', 'called', 'serving']).executeTakeFirst()
    if (!t) throw new HttpError(404, 'El turno no existe o ya terminó')
    await ctx.db.updateTable('tickets').set({ status: 'cancelled', finished_at: nowIso() }).where('id', '=', id).execute()
    await ctx.db.insertInto('ticket_events').values({ ticket_id: id, type: 'cancelled', user_id: req.user!.id, data: null, created_at: nowIso() }).execute()
    ctx.hub.broadcast({ type: 'queue', sectorIds: [t.sector_id] })
    return { ok: true }
  })

  app.get('/api/admin/system', pre, async () => {
    const t0 = Date.now()
    await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
    const serverInfo =
      ctx.client === 'postgres' ? `${ctx.cfg.postgres.host}:${ctx.cfg.postgres.port}`
      : ctx.client === 'mssql' ? `${ctx.cfg.mssql.server}${ctx.cfg.mssql.instance ? '\\' + ctx.cfg.mssql.instance : ':' + ctx.cfg.mssql.port}`
      : ctx.cfg.sqlitePath
    const database =
      ctx.client === 'postgres' ? ctx.cfg.postgres.database
      : ctx.client === 'mssql' ? ctx.cfg.mssql.database
      : 'sqlite'
    return { db: ctx.client, dbLatencyMs: Date.now() - t0, server: serverInfo, database, timezone: ctx.cfg.timezone, wsClients: ctx.hub.size, node: process.version, uptimeSec: Math.round(process.uptime()) }
  })
}

  const staff = { preHandler: requireRole(ctx, 'owner', 'admin', 'tech') }

  app.get('/api/admin/priorities', staff, async () =>
    ctx.db.selectFrom('priorities').selectAll().orderBy('sort_order').orderBy('weight').execute(),
  )
  app.post('/api/admin/priorities', pre, async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        weight: z.number().int().min(0).max(1000),
        color: color.nullish(),
        sortOrder: z.number().int().min(0).max(999).optional(),
      })
      .parse(req.body)
    const id = await insertId(ctx, ctx.db, 'priorities', {
      name: b.name,
      weight: b.weight,
      color: b.color ?? null,
      sort_order: b.sortOrder ?? 0,
      active: 1,
    })
    await audit(ctx, { userId: req.user!.id, action: 'priority.create', entity: 'priority', entityId: id, ip: req.ip })
    return { id }
  })
  app.put('/api/admin/priorities/:id', pre, async (req) => {
    const id = idParam(req)
    const b = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        weight: z.number().int().min(0).max(1000).optional(),
        color: color.nullish(),
        sortOrder: z.number().int().optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body)
    const set: any = {}
    if (b.name != null) set.name = b.name
    if (b.weight != null) set.weight = b.weight
    if (b.color !== undefined) set.color = b.color
    if (b.sortOrder != null) set.sort_order = b.sortOrder
    if (b.active != null) set.active = b.active ? 1 : 0
    if (Object.keys(set).length) await ctx.db.updateTable('priorities').set(set).where('id', '=', id).execute()
    await audit(ctx, { userId: req.user!.id, action: 'priority.update', entity: 'priority', entityId: id, detail: b, ip: req.ip })
    return { ok: true }
  })

  app.get('/api/admin/desks', staff, async (req) => {
    const sectorId = z.coerce.number().int().positive().optional().parse((req.query as any).sectorId)
    let q = ctx.db.selectFrom('desks').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('name')
    if (sectorId) q = q.where('sector_id', '=', sectorId) as any
    return q.execute()
  })
  app.post('/api/admin/desks', pre, async (req) => {
    const b = z
      .object({
        sectorId: z.number().int().positive(),
        name: z.string().trim().min(1).max(80),
        code: z.string().trim().min(1).max(20),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body)
    await sectorExists(b.sectorId)
    const id = await insertId(ctx, ctx.db, 'desks', {
      sector_id: b.sectorId,
      name: b.name,
      code: b.code,
      active: 1,
      sort_order: b.sortOrder ?? 0,
    })
    await audit(ctx, { userId: req.user!.id, action: 'desk.create', entity: 'desk', entityId: id, ip: req.ip })
    return { id }
  })
  app.put('/api/admin/desks/:id', pre, async (req) => {
    const id = idParam(req)
    const b = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        code: z.string().trim().min(1).max(20).optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body)
    const set: any = {}
    if (b.name != null) set.name = b.name
    if (b.code != null) set.code = b.code
    if (b.active != null) set.active = b.active ? 1 : 0
    if (b.sortOrder != null) set.sort_order = b.sortOrder
    if (Object.keys(set).length) await ctx.db.updateTable('desks').set(set).where('id', '=', id).execute()
    return { ok: true }
  })

  app.get('/api/admin/stations', staff, async () =>
    ctx.db
      .selectFrom('stations')
      .leftJoin('sectors', 'sectors.id', 'stations.sector_id')
      .select([
        'stations.id',
        'stations.kind',
        'stations.name',
        'stations.sector_id',
        'stations.device_key',
        'stations.active',
        'stations.last_seen_at',
        'stations.created_at',
        'sectors.name as sector_name',
      ])
      .orderBy('stations.kind')
      .orderBy('stations.name')
      .execute(),
  )
  app.post('/api/admin/stations', pre, async (req) => {
    const b = z
      .object({
        kind: z.enum(['totem', 'tv']),
        name: z.string().trim().min(1).max(100),
        sectorId: z.number().int().positive().nullish(),
        deviceKey: z.string().trim().min(8).max(64).optional(),
      })
      .parse(req.body)
    if (b.sectorId) await sectorExists(b.sectorId)
    const device_key = b.deviceKey ?? `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    const id = await insertId(ctx, ctx.db, 'stations', {
      kind: b.kind,
      name: b.name,
      sector_id: b.sectorId ?? null,
      device_key,
      active: 1,
      last_seen_at: null,
      created_at: nowIso(),
    })
    await audit(ctx, { userId: req.user!.id, action: 'station.create', entity: 'station', entityId: id, ip: req.ip })
    return { id, deviceKey: device_key }
  })
  app.put('/api/admin/stations/:id', pre, async (req) => {
    const id = idParam(req)
    const b = z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        sectorId: z.number().int().positive().nullish(),
        active: z.boolean().optional(),
      })
      .parse(req.body)
    const set: any = {}
    if (b.name != null) set.name = b.name
    if (b.sectorId !== undefined) set.sector_id = b.sectorId
    if (b.active != null) set.active = b.active ? 1 : 0
    if (Object.keys(set).length) await ctx.db.updateTable('stations').set(set).where('id', '=', id).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.get('/api/admin/stats', staff, async (req) => {
    const t = businessDate(ctx.cfg.timezone)
    const qy = req.query as any
    const from = dateStr.parse(qy.from ?? t)
    const to = dateStr.parse(qy.to ?? t)
    if (from > to) throw new HttpError(400, 'Rango de fechas inválido')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw new HttpError(400, 'Máximo 366 días')
    return detailedReport(ctx, from, to)
  })

  app.get('/api/admin/stats/export.csv', staff, async (req, reply) => {
    const t = businessDate(ctx.cfg.timezone)
    const qy = req.query as any
    const from = dateStr.parse(qy.from ?? t)
    const to = dateStr.parse(qy.to ?? t)
    const data = await detailedReport(ctx, from, to)
    const header = 'fecha,codigo,estado,prioridad,secretaria,boton,escritorio,creado,llamado,finalizado,espera_min,atencion_min,rellamados\n'
    const lines = data.tickets.map(
      (r) =>
        `${r.date},${r.code},${r.status},${r.priority},"${r.sectorName}","${r.buttonLabel}",${r.desk ?? ''},${r.createdAt ?? ''},${r.calledAt ?? ''},${r.finishedAt ?? ''},${r.waitMin ?? ''},${r.serviceMin ?? ''},${r.recalls}`,
    )
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="celtto-report-${from}_${to}.csv"`)
    return header + lines.join('\n')
  })

  app.post('/api/admin/day-close', pre, async (req) => {
    const b = z.object({ date: dateStr.optional(), notes: z.string().max(500).optional() }).parse(req.body ?? {})
    const date = b.date ?? businessDate(ctx.cfg.timezone)
    const existing = await ctx.db.selectFrom('day_closes').select('id').where('business_date', '=', date).executeTakeFirst()
    if (existing) throw new HttpError(409, 'Ese día ya fue cerrado')
    const snap = await detailedReport(ctx, date, date)
    await ctx.db
      .updateTable('tickets')
      .set({ status: 'cancelled', finished_at: nowIso() })
      .where('business_date', '=', date)
      .where('status', 'in', ['waiting', 'called', 'serving'])
      .execute()
    const id = await insertId(ctx, ctx.db, 'day_closes', {
      business_date: date,
      closed_by: req.user!.id,
      notes: b.notes ?? null,
      snapshot: JSON.stringify({ total: snap.total, byStatus: snap.byStatus, avgWaitMin: snap.avgWaitMin }).slice(0, 7900),
      created_at: nowIso(),
    })
    await audit(ctx, { userId: req.user!.id, action: 'day.close', entity: 'day', entityId: date, ip: req.ip })
    ctx.hub.broadcast({ type: 'queue' })
    return { id, date }
  })

  app.get('/api/admin/audit', staff, async (req) => {
    const limit = Math.min(500, Number((req.query as any).limit ?? 100) || 100)
    return ctx.db.selectFrom('audit_log').selectAll().orderBy('id', 'desc').limit(limit).execute()
  })

  app.get('/api/admin/system', staff, async () => {
    const t0 = Date.now()
    await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
    const serverInfo =
      ctx.client === 'postgres'
        ? `${ctx.cfg.postgres.host}:${ctx.cfg.postgres.port}`
        : ctx.client === 'mssql'
          ? `${ctx.cfg.mssql.server}`
          : ctx.cfg.sqlitePath
    const database =
      ctx.client === 'postgres' ? ctx.cfg.postgres.database : ctx.client === 'mssql' ? ctx.cfg.mssql.database : 'sqlite'
    return {
      db: ctx.client,
      dbLatencyMs: Date.now() - t0,
      server: serverInfo,
      database,
      timezone: ctx.cfg.timezone,
      wsClients: ctx.hub.size,
      redis: Boolean(ctx.cfg.redisUrl),
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      version: '1.1.0',
    }
  })
