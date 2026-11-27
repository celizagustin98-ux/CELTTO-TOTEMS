import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { MANAGER_ROLES, STAFF_ROLES, requireRole } from './auth.js'
import type { Ctx } from './db.js'
import { businessDate, insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { overview, report } from './queue.js'
import { csvCell, hashPassword } from './security.js'
import { getSettings, saveSettings, settingsPatch } from './settings.js'
import { audit } from './audit.js'
import { detailedReport } from './reports.js'
import type { UserRole } from './types.js'

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido')
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
const icon = z.string().trim().regex(/^[a-z0-9-]{1,40}$/, 'Ícono inválido').nullish()
const sectorBody = z.object({
  name: z.string().trim().min(1).max(100),
  color,
  welcomeMessage: z.string().trim().max(200).nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})
const buttonBody = z.object({
  sectorId: z.number().int().positive(),
  targetSectorId: z.number().int().positive().optional(),
  label: z.string().trim().min(1).max(100),
  subtitle: z.string().trim().max(160).nullish(),
  color: color.nullish(),
  icon,
  prefix: z.string().trim().regex(/^[A-Za-z0-9]{1,3}$/, 'El prefijo debe tener de 1 a 3 letras o números').transform((s) => s.toUpperCase()),
  priority: z.number().int().min(0).max(1000).default(0),
  priorityId: z.number().int().positive().nullish(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})
const roleEnum = z.enum(['admin', 'tech', 'secretary'])
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'Usuario: 3 a 40 caracteres (letras, números, punto, guion)')
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200)
const userCreate = z.object({
  username,
  displayName: z.string().trim().min(1).max(100),
  password,
  role: roleEnum.default('secretary'),
  sectorId: z.number().int().positive().nullish(),
  desk: z.string().trim().max(60).nullish(),
  deskId: z.number().int().positive().nullish(),
})
const userUpdate = z
  .object({
    displayName: z.string().trim().min(1).max(100),
    role: roleEnum,
    sectorId: z.number().int().positive().nullish(),
    desk: z.string().trim().max(60).nullish(),
    deskId: z.number().int().positive().nullish(),
    active: z.boolean(),
    password: password.optional(),
  })
  .partial()
const idParam = (req: any) => z.coerce.number().int().positive().parse(req.params.id)
const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const

export function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  /** Modificar configuración: dueño y administradores. */
  const mgr = { preHandler: requireRole(ctx, ...MANAGER_ROLES) }
  /** Consultar y operar estaciones: también el técnico. */
  const staff = { preHandler: requireRole(ctx, ...STAFF_ROLES) }

  const sectorExists = async (id: number) => {
    if (!(await ctx.db.selectFrom('sectors').select('id').where('id', '=', id).where('active', '=', 1).executeTakeFirst()))
      throw new HttpError(404, 'La secretaría no existe')
  }
  const priorityWeight = async (priorityId: number | null | undefined, fallback: number) => {
    if (!priorityId) return { id: null, weight: fallback }
    const p = await ctx.db.selectFrom('priorities').select(['id', 'weight']).where('id', '=', priorityId).executeTakeFirst()
    if (!p) throw new HttpError(404, 'La prioridad no existe')
    return { id: p.id, weight: p.weight }
  }
  const deskFor = async (deskId: number | null | undefined, sectorId: number | null | undefined) => {
    if (!deskId) return null
    const d = await ctx.db.selectFrom('desks').select(['id', 'name', 'sector_id']).where('id', '=', deskId).where('active', '=', 1).executeTakeFirst()
    if (!d) throw new HttpError(404, 'El escritorio no existe')
    if (sectorId && d.sector_id !== sectorId) throw new HttpError(400, 'El escritorio pertenece a otra secretaría')
    return d
  }
  const log = (req: any, action: string, entity?: string, entityId?: string | number, detail?: unknown) =>
    audit(ctx, { userId: req.user?.id, action, entity, entityId, detail, ip: req.ip })

  // ---------- Secretarías y botones ----------
  app.get('/api/admin/sectors', staff, async () => {
    const sectors = await ctx.db.selectFrom('sectors').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
    const buttons = await ctx.db.selectFrom('buttons').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('id').execute()
    return sectors.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      welcomeMessage: s.welcome_message,
      sortOrder: s.sort_order,
      buttons: buttons
        .filter((b) => b.sector_id === s.id)
        .map((b) => ({
          id: b.id, sectorId: b.sector_id, targetSectorId: b.target_sector_id, label: b.label, subtitle: b.subtitle, color: b.color,
          icon: b.icon, prefix: b.prefix, priority: b.priority, priorityId: b.priority_id, sortOrder: b.sort_order,
        })),
    }))
  })

  app.post('/api/admin/sectors', mgr, async (req) => {
    const b = sectorBody.parse(req.body)
    const max = await ctx.db.selectFrom('sectors').select((eb) => eb.fn.max('sort_order').as('m')).where('active', '=', 1).executeTakeFirst()
    const id = await insertId(ctx, ctx.db, 'sectors', {
      name: b.name, color: b.color, welcome_message: b.welcomeMessage || null, sort_order: b.sortOrder ?? Number(max?.m ?? 0) + 1, active: 1, created_at: nowIso(),
    })
    await log(req, 'sector.create', 'sector', id, { name: b.name })
    ctx.hub.broadcast({ type: 'config' })
    return { id }
  })

  app.put('/api/admin/sectors/:id', mgr, async (req) => {
    const id = idParam(req)
    const b = sectorBody.parse(req.body)
    await sectorExists(id)
    const set: Record<string, unknown> = { name: b.name, color: b.color, welcome_message: b.welcomeMessage || null }
    if (b.sortOrder !== undefined) set.sort_order = b.sortOrder
    await ctx.db.updateTable('sectors').set(set).where('id', '=', id).execute()
    await log(req, 'sector.update', 'sector', id, { name: b.name })
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.put('/api/admin/sectors/order', mgr, async (req) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(200) }).parse(req.body)
    for (const [i, id] of ids.entries()) await ctx.db.updateTable('sectors').set({ sort_order: i + 1 }).where('id', '=', id).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.delete('/api/admin/sectors/:id', mgr, async (req) => {
    const id = idParam(req)
    await sectorExists(id)
    const waiting = await ctx.db
      .selectFrom('tickets')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('sector_id', '=', id)
      .where('business_date', '=', businessDate(ctx.cfg.timezone))
      .where('status', 'in', ['waiting', 'called', 'serving'])
      .executeTakeFirstOrThrow()
    if (Number(waiting.n) > 0) throw new HttpError(409, 'La secretaría tiene turnos en curso. Atendelos o cancelalos antes de eliminarla.')
    const incoming = await ctx.db
      .selectFrom('buttons')
      .select('label')
      .where('target_sector_id', '=', id)
      .where('sector_id', '!=', id)
      .where('active', '=', 1)
      .executeTakeFirst()
    if (incoming) throw new HttpError(409, `El botón "${incoming.label}" de otra secretaría genera turnos para esta. Cambialo antes de eliminarla.`)
    await ctx.db.updateTable('buttons').set({ active: 0 }).where('sector_id', '=', id).execute()
    await ctx.db.updateTable('desks').set({ active: 0 }).where('sector_id', '=', id).execute()
    await ctx.db.updateTable('users').set({ sector_id: null, desk_id: null }).where('sector_id', '=', id).execute()
    await ctx.db.updateTable('stations').set({ sector_id: null }).where('sector_id', '=', id).execute()
    await ctx.db.updateTable('sectors').set({ active: 0 }).where('id', '=', id).execute()
    await log(req, 'sector.delete', 'sector', id)
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.post('/api/admin/buttons', mgr, async (req) => {
    const b = buttonBody.parse(req.body)
    await sectorExists(b.sectorId)
    await sectorExists(b.targetSectorId ?? b.sectorId)
    const p = await priorityWeight(b.priorityId, b.priority)
    const max = await ctx.db.selectFrom('buttons').select((eb) => eb.fn.max('sort_order').as('m')).where('sector_id', '=', b.sectorId).where('active', '=', 1).executeTakeFirst()
    const id = await insertId(ctx, ctx.db, 'buttons', {
      sector_id: b.sectorId, target_sector_id: b.targetSectorId ?? b.sectorId, label: b.label, subtitle: b.subtitle || null, color: b.color || null,
      icon: b.icon || null, prefix: b.prefix, priority: p.weight, priority_id: p.id, sort_order: b.sortOrder ?? Number(max?.m ?? 0) + 1, active: 1,
    })
    await log(req, 'button.create', 'button', id, { label: b.label })
    ctx.hub.broadcast({ type: 'config' })
    return { id }
  })

  app.put('/api/admin/buttons/:id', mgr, async (req) => {
    const id = idParam(req)
    const b = buttonBody.parse(req.body)
    await sectorExists(b.sectorId)
    await sectorExists(b.targetSectorId ?? b.sectorId)
    const p = await priorityWeight(b.priorityId, b.priority)
    const set: Record<string, unknown> = {
      sector_id: b.sectorId, target_sector_id: b.targetSectorId ?? b.sectorId, label: b.label, subtitle: b.subtitle || null, color: b.color || null,
      icon: b.icon || null, prefix: b.prefix, priority: p.weight, priority_id: p.id,
    }
    if (b.sortOrder !== undefined) set.sort_order = b.sortOrder
    const r = await ctx.db.updateTable('buttons').set(set).where('id', '=', id).where('active', '=', 1).executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) throw new HttpError(404, 'El botón no existe')
    await log(req, 'button.update', 'button', id, { label: b.label })
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.put('/api/admin/buttons/order', mgr, async (req) => {
    const { sectorId, ids } = z.object({ sectorId: z.number().int().positive(), ids: z.array(z.number().int().positive()).max(100) }).parse(req.body)
    for (const [i, id] of ids.entries())
      await ctx.db.updateTable('buttons').set({ sort_order: i + 1 }).where('id', '=', id).where('sector_id', '=', sectorId).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.delete('/api/admin/buttons/:id', mgr, async (req) => {
    const id = idParam(req)
    const r = await ctx.db.updateTable('buttons').set({ active: 0 }).where('id', '=', id).executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) throw new HttpError(404, 'El botón no existe')
    await log(req, 'button.delete', 'button', id)
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  // ---------- Usuarios ----------
  /** El dueño administra a todos; un administrador solo a técnicos y secretarias. */
  const canManage = (actor: UserRole, target: UserRole) => actor === 'owner' ? target !== 'owner' : actor === 'admin' && (target === 'tech' || target === 'secretary')

  app.get('/api/admin/users', mgr, async () => {
    const rows = await ctx.db
      .selectFrom('users')
      .leftJoin('sectors', 'sectors.id', 'users.sector_id')
      .select(['users.id', 'users.username', 'users.display_name', 'users.role', 'users.sector_id', 'users.desk', 'users.desk_id', 'users.active', 'users.last_login_at', 'users.created_at', 'sectors.name as sector_name'])
      .orderBy('users.display_name')
      .execute()
    return rows.map((u) => ({
      id: u.id, username: u.username, displayName: u.display_name, role: u.role, sectorId: u.sector_id, sectorName: u.sector_name,
      desk: u.desk, deskId: u.desk_id, active: u.active === 1, lastLoginAt: u.last_login_at, createdAt: u.created_at,
    }))
  })

  app.post('/api/admin/users', mgr, async (req) => {
    const b = userCreate.parse(req.body)
    if (!canManage(req.user!.role, b.role)) throw new HttpError(403, 'No podés crear usuarios con ese rol')
    if (b.role === 'secretary' && !b.sectorId) throw new HttpError(400, 'Elegí la secretaría del usuario')
    if (b.sectorId) await sectorExists(b.sectorId)
    const desk = await deskFor(b.deskId, b.sectorId)
    if (await ctx.db.selectFrom('users').select('id').where('username', '=', b.username).executeTakeFirst()) throw new HttpError(409, 'Ese nombre de usuario ya existe')
    const id = await insertId(ctx, ctx.db, 'users', {
      username: b.username, display_name: b.displayName, password_hash: await hashPassword(b.password), role: b.role,
      sector_id: b.role === 'secretary' ? b.sectorId ?? null : null, desk: desk?.name ?? (b.desk || null), desk_id: desk?.id ?? null,
      active: 1, last_login_at: null, created_at: nowIso(),
    })
    await log(req, 'user.create', 'user', id, { username: b.username, role: b.role })
    return { id }
  })

  app.put('/api/admin/users/:id', mgr, async (req) => {
    const id = idParam(req)
    const b = userUpdate.parse(req.body)
    const u = await ctx.db.selectFrom('users').select(['id', 'role', 'sector_id']).where('id', '=', id).executeTakeFirst()
    if (!u) throw new HttpError(404, 'El usuario no existe')
    if (!canManage(req.user!.role, u.role as UserRole) || (b.role && !canManage(req.user!.role, b.role))) throw new HttpError(403, 'No podés modificar este usuario')
    const role = b.role ?? (u.role as UserRole)
    const sectorId = b.sectorId !== undefined ? b.sectorId : u.sector_id
    if (role === 'secretary' && !sectorId) throw new HttpError(400, 'Elegí la secretaría del usuario')
    if (b.sectorId) await sectorExists(b.sectorId)
    const set: Record<string, unknown> = {}
    if (b.displayName !== undefined) set.display_name = b.displayName
    if (b.role !== undefined) set.role = b.role
    if (b.sectorId !== undefined || b.role !== undefined) set.sector_id = role === 'secretary' ? sectorId : null
    if (b.deskId !== undefined) {
      const desk = await deskFor(b.deskId, sectorId)
      set.desk_id = desk?.id ?? null
      if (desk) set.desk = desk.name
    }
    if (b.desk !== undefined && !set.desk) set.desk = b.desk || null
    if (b.active !== undefined) set.active = b.active ? 1 : 0
    if (b.password) set.password_hash = await hashPassword(b.password)
    if (Object.keys(set).length) await ctx.db.updateTable('users').set(set as any).where('id', '=', id).execute()
    if (b.active === false || b.password || b.role) await ctx.db.deleteFrom('sessions').where('user_id', '=', id).execute()
    await log(req, 'user.update', 'user', id, { ...b, password: b.password ? '***' : undefined })
    return { ok: true }
  })

  app.delete('/api/admin/users/:id', mgr, async (req) => {
    const id = idParam(req)
    if (id === req.user!.id) throw new HttpError(400, 'No podés eliminar tu propio usuario')
    const u = await ctx.db.selectFrom('users').select(['id', 'role', 'username']).where('id', '=', id).executeTakeFirst()
    if (!u) throw new HttpError(404, 'El usuario no existe')
    if (!canManage(req.user!.role, u.role as UserRole)) throw new HttpError(403, 'No podés eliminar este usuario')
    await ctx.db.deleteFrom('sessions').where('user_id', '=', id).execute()
    const used = await ctx.db.selectFrom('tickets').select('id').where('called_by', '=', id).limit(1).executeTakeFirst()
    if (used) {
      // Tiene historial de atención: se desactiva y se libera el nombre de usuario para conservar los reportes
      await ctx.db
        .updateTable('users')
        .set({ active: 0, username: `${u.username.slice(0, 40)}.baja${id}`, password_hash: await hashPassword(randomBytes(24).toString('hex')) })
        .where('id', '=', id)
        .execute()
    } else {
      await ctx.db.deleteFrom('users').where('id', '=', id).execute()
    }
    await log(req, 'user.delete', 'user', id, { username: u.username })
    return { ok: true, archived: Boolean(used) }
  })

  // ---------- Configuración y logo ----------
  app.get('/api/admin/settings', mgr, async () => getSettings(ctx))
  app.put('/api/admin/settings', mgr, async (req) => {
    const patch = settingsPatch.parse(req.body)
    await saveSettings(ctx, patch)
    await log(req, 'settings.update', 'settings', undefined, { keys: Object.keys(patch) })
    ctx.hub.broadcast({ type: 'config' })
    return getSettings(ctx)
  })

  app.put('/api/admin/logo', mgr, async (req) => {
    const { dataUrl } = z.object({ dataUrl: z.string().max(700_000) }).parse(req.body)
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!m || !LOGO_MIMES.includes(m[1] as (typeof LOGO_MIMES)[number])) throw new HttpError(400, 'El logo tiene que ser PNG, JPG o WEBP')
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > 500_000) throw new HttpError(400, 'El logo no puede superar los 500 KB')
    const now = nowIso()
    const r = await ctx.db.updateTable('assets').set({ mime: m[1], data: m[2], updated_at: now }).where('asset_key', '=', 'logo').executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) await ctx.db.insertInto('assets').values({ asset_key: 'logo', mime: m[1], data: m[2], updated_at: now }).execute()
    await log(req, 'logo.update')
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true, version: now }
  })

  app.delete('/api/admin/logo', mgr, async (req) => {
    await ctx.db.deleteFrom('assets').where('asset_key', '=', 'logo').execute()
    await log(req, 'logo.delete')
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  // ---------- Operación del día ----------
  app.get('/api/admin/overview', staff, async () => overview(ctx))

  app.get('/api/admin/reports', staff, async (req) => {
    const t = businessDate(ctx.cfg.timezone)
    const qy = req.query as any
    const from = dateStr.parse(qy.from ?? t)
    const to = dateStr.parse(qy.to ?? t)
    if (from > to) throw new HttpError(400, 'La fecha "desde" no puede ser posterior a "hasta"')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) throw new HttpError(400, 'El rango máximo es de 92 días')
    return report(ctx, from, to)
  })

  app.get('/api/admin/tickets', staff, async (req) => {
    const qy = req.query as any
    const date = dateStr.parse(qy.date ?? businessDate(ctx.cfg.timezone))
    const rows = await ctx.db
      .selectFrom('tickets')
      .innerJoin('sectors', 'sectors.id', 'tickets.sector_id')
      .innerJoin('buttons', 'buttons.id', 'tickets.button_id')
      .select(['tickets.id', 'tickets.code', 'tickets.status', 'tickets.created_at', 'tickets.called_at', 'tickets.finished_at', 'tickets.desk', 'tickets.dni', 'sectors.name as sector_name', 'sectors.color as sector_color', 'buttons.label'])
      .where('tickets.business_date', '=', date)
      .orderBy('tickets.id', 'desc')
      .limit(500)
      .execute()
    return rows.map((r) => ({
      id: r.id, code: r.code, status: r.status, sectorName: r.sector_name, sectorColor: r.sector_color, label: r.label,
      createdAt: r.created_at, calledAt: r.called_at, finishedAt: r.finished_at, desk: r.desk, dni: r.dni,
    }))
  })

  app.post('/api/admin/tickets/:id/cancel', mgr, async (req) => {
    const id = idParam(req)
    const t = await ctx.db.selectFrom('tickets').select(['id', 'sector_id', 'code']).where('id', '=', id).where('status', 'in', ['waiting', 'called', 'serving']).executeTakeFirst()
    if (!t) throw new HttpError(404, 'El turno no existe o ya terminó')
    await ctx.db.updateTable('tickets').set({ status: 'cancelled', finished_at: nowIso() }).where('id', '=', id).execute()
    await ctx.db.insertInto('ticket_events').values({ ticket_id: id, type: 'cancelled', user_id: req.user!.id, data: null, created_at: nowIso() }).execute()
    await log(req, 'ticket.cancel', 'ticket', id, { code: t.code })
    ctx.hub.broadcast({ type: 'queue', sectorIds: [t.sector_id] })
    return { ok: true }
  })

  app.get('/api/admin/ops-alerts', staff, async () => {
    const settings = await getSettings(ctx)
    const date = businessDate(ctx.cfg.timezone)
    const rows = await ctx.db
      .selectFrom('tickets')
      .innerJoin('sectors', 'sectors.id', 'tickets.sector_id')
      .select((eb) => ['sectors.id', 'sectors.name', eb.fn.countAll<number>().as('waiting')])
      .where('tickets.business_date', '=', date)
      .where('tickets.status', '=', 'waiting')
      .groupBy(['sectors.id', 'sectors.name'])
      .execute()
    const alerts: Record<string, unknown>[] = []
    for (const r of rows) {
      const w = Number(r.waiting)
      if (w >= settings.alert_queue_waiting) alerts.push({ type: 'queue_high', sectorId: r.id, sectorName: r.name, waiting: w, threshold: settings.alert_queue_waiting })
    }
    const stations = await ctx.db.selectFrom('stations').select(['id', 'name', 'kind', 'last_seen_at']).where('active', '=', 1).execute()
    const now = Date.now()
    for (const s of stations) {
      if (s.last_seen_at && now - Date.parse(s.last_seen_at) > 15 * 60_000)
        alerts.push({ type: 'station_stale', stationId: s.id, name: s.name, kind: s.kind, lastSeenAt: s.last_seen_at })
    }
    if (settings.totem_pin === '0000') alerts.push({ type: 'default_pin' })
    return { alerts, at: new Date().toISOString() }
  })

  // ---------- Prioridades ----------
  const priorityBody = z.object({
    name: z.string().trim().min(1).max(80),
    weight: z.number().int().min(0).max(1000),
    color: color.nullish(),
    sortOrder: z.number().int().min(0).max(999).optional(),
    active: z.boolean().optional(),
  })
  app.get('/api/admin/priorities', staff, async () =>
    (await ctx.db.selectFrom('priorities').selectAll().orderBy('weight').orderBy('sort_order').execute()).map((p) => ({ ...p, active: p.active === 1 })),
  )
  app.post('/api/admin/priorities', mgr, async (req) => {
    const b = priorityBody.parse(req.body)
    const id = await insertId(ctx, ctx.db, 'priorities', { name: b.name, weight: b.weight, color: b.color ?? null, sort_order: b.sortOrder ?? 0, active: 1 })
    await log(req, 'priority.create', 'priority', id, { name: b.name })
    return { id }
  })
  app.put('/api/admin/priorities/:id', mgr, async (req) => {
    const id = idParam(req)
    const b = priorityBody.partial().parse(req.body)
    const set: Record<string, unknown> = {}
    if (b.name != null) set.name = b.name
    if (b.weight != null) set.weight = b.weight
    if (b.color !== undefined) set.color = b.color
    if (b.sortOrder != null) set.sort_order = b.sortOrder
    if (b.active != null) set.active = b.active ? 1 : 0
    if (Object.keys(set).length) await ctx.db.updateTable('priorities').set(set).where('id', '=', id).execute()
    // Los botones que usan esta prioridad toman el nuevo peso
    if (b.weight != null) await ctx.db.updateTable('buttons').set({ priority: b.weight }).where('priority_id', '=', id).execute()
    await log(req, 'priority.update', 'priority', id, b)
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  // ---------- Escritorios ----------
  const deskBody = z.object({
    sectorId: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    code: z.string().trim().min(1).max(20),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  app.get('/api/admin/desks', staff, async (req) => {
    const sectorId = z.coerce.number().int().positive().optional().parse((req.query as any).sectorId)
    let q = ctx.db.selectFrom('desks').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('name')
    if (sectorId) q = q.where('sector_id', '=', sectorId)
    return q.execute()
  })
  app.post('/api/admin/desks', mgr, async (req) => {
    const b = deskBody.parse(req.body)
    await sectorExists(b.sectorId)
    const id = await insertId(ctx, ctx.db, 'desks', { sector_id: b.sectorId, name: b.name, code: b.code, active: 1, sort_order: b.sortOrder ?? 0 })
    await log(req, 'desk.create', 'desk', id, { name: b.name })
    return { id }
  })
  app.put('/api/admin/desks/:id', mgr, async (req) => {
    const id = idParam(req)
    const b = deskBody.omit({ sectorId: true }).partial().extend({ active: z.boolean().optional() }).parse(req.body)
    const set: Record<string, unknown> = {}
    if (b.name != null) set.name = b.name
    if (b.code != null) set.code = b.code
    if (b.active != null) set.active = b.active ? 1 : 0
    if (b.sortOrder != null) set.sort_order = b.sortOrder
    if (Object.keys(set).length) await ctx.db.updateTable('desks').set(set).where('id', '=', id).execute()
    if (b.active === false) await ctx.db.updateTable('users').set({ desk_id: null }).where('desk_id', '=', id).execute()
    if (b.name) await ctx.db.updateTable('users').set({ desk: b.name }).where('desk_id', '=', id).execute()
    await log(req, 'desk.update', 'desk', id, b)
    return { ok: true }
  })

  // ---------- Estaciones (tótems y TVs) ----------
  const stationKey = () => `st_${randomBytes(12).toString('base64url')}`
  app.get('/api/admin/stations', staff, async () =>
    ctx.db
      .selectFrom('stations')
      .leftJoin('sectors', 'sectors.id', 'stations.sector_id')
      .select(['stations.id', 'stations.kind', 'stations.name', 'stations.sector_id', 'stations.device_key', 'stations.active', 'stations.lang', 'stations.last_seen_at', 'stations.created_at', 'sectors.name as sector_name', 'sectors.color as sector_color'])
      .where('stations.active', '=', 1)
      .orderBy('stations.kind')
      .orderBy('stations.name')
      .execute(),
  )
  const stationBody = z.object({
    kind: z.enum(['totem', 'tv']),
    name: z.string().trim().min(1).max(100),
    sectorId: z.number().int().positive().nullish(),
    lang: z.enum(['es', 'en', 'pt', 'it']).nullish(),
  })
  app.post('/api/admin/stations', staff, async (req) => {
    const b = stationBody.parse(req.body)
    if (b.sectorId) await sectorExists(b.sectorId)
    const device_key = stationKey()
    const id = await insertId(ctx, ctx.db, 'stations', {
      kind: b.kind, name: b.name, sector_id: b.sectorId ?? null, device_key, active: 1, lang: b.lang ?? null, last_seen_at: null, created_at: nowIso(),
    })
    await log(req, 'station.create', 'station', id, { name: b.name })
    return { id, deviceKey: device_key }
  })
  app.put('/api/admin/stations/:id', staff, async (req) => {
    const id = idParam(req)
    const b = stationBody.omit({ kind: true }).partial().extend({ active: z.boolean().optional() }).parse(req.body)
    if (b.sectorId) await sectorExists(b.sectorId)
    const set: Record<string, unknown> = {}
    if (b.name != null) set.name = b.name
    if (b.sectorId !== undefined) set.sector_id = b.sectorId
    if (b.lang !== undefined) set.lang = b.lang
    if (b.active != null) set.active = b.active ? 1 : 0
    if (Object.keys(set).length) await ctx.db.updateTable('stations').set(set).where('id', '=', id).execute()
    await log(req, 'station.update', 'station', id, b)
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })
  /** Genera una URL nueva: la anterior deja de funcionar (por si se filtró). */
  app.post('/api/admin/stations/:id/rotate', staff, async (req) => {
    const id = idParam(req)
    const device_key = stationKey()
    const r = await ctx.db.updateTable('stations').set({ device_key }).where('id', '=', id).executeTakeFirst()
    if (Number(r.numUpdatedRows) === 0) throw new HttpError(404, 'La estación no existe')
    await log(req, 'station.rotate', 'station', id)
    ctx.hub.broadcast({ type: 'config' })
    return { deviceKey: device_key }
  })
  app.delete('/api/admin/stations/:id', staff, async (req) => {
    const id = idParam(req)
    await ctx.db.updateTable('stations').set({ active: 0, device_key: stationKey() }).where('id', '=', id).execute()
    await log(req, 'station.delete', 'station', id)
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  // ---------- Estadísticas ----------
  const range = (req: any, maxDays: number) => {
    const t = businessDate(ctx.cfg.timezone)
    const qy = req.query as any
    const from = dateStr.parse(qy.from ?? t)
    const to = dateStr.parse(qy.to ?? t)
    if (from > to) throw new HttpError(400, 'Rango de fechas inválido')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > maxDays) throw new HttpError(400, `Máximo ${maxDays} días`)
    return { from, to }
  }
  app.get('/api/admin/stats', staff, async (req) => {
    const { from, to } = range(req, 366)
    const r = await detailedReport(ctx, from, to)
    // El detalle se limita a los últimos 500 turnos (el CSV trae todos)
    return { ...r, ticketCount: r.tickets.length, tickets: r.tickets.slice(-500).reverse() }
  })

  app.get('/api/admin/stats/export.csv', staff, async (req, reply) => {
    const { from, to } = range(req, 366)
    const data = await detailedReport(ctx, from, to)
    const header = ['fecha', 'codigo', 'estado', 'prioridad', 'secretaria', 'boton', 'escritorio', 'dni', 'creado', 'llamado', 'finalizado', 'espera_min', 'atencion_min', 'rellamados']
    const lines = data.tickets.map((r) =>
      [r.date, r.code, r.status, r.priority, r.sectorName, r.buttonLabel, r.desk, r.dni, r.createdAt, r.calledAt, r.finishedAt,
        r.waitMin != null ? r.waitMin.toFixed(1) : '', r.serviceMin != null ? r.serviceMin.toFixed(1) : '', r.recalls].map(csvCell).join(','),
    )
    await log(req, 'stats.export', 'report', `${from}_${to}`)
    reply.header('Content-Type', 'text/csv; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="celtto-report-${from}_${to}.csv"`)
    return '﻿' + header.join(',') + '\n' + lines.join('\n')
  })

  app.post('/api/admin/day-close', mgr, async (req) => {
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
    await log(req, 'day.close', 'day', date)
    ctx.hub.broadcast({ type: 'queue', sectorIds: [] })
    return { id, date }
  })

  app.get('/api/admin/audit', mgr, async (req) => {
    const limit = Math.min(500, Number((req.query as any).limit ?? 100) || 100)
    const rows = await ctx.db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.user_id')
      .select(['audit_log.id', 'audit_log.action', 'audit_log.entity', 'audit_log.entity_id', 'audit_log.detail', 'audit_log.ip', 'audit_log.created_at', 'users.display_name as user_name'])
      .orderBy('audit_log.id', 'desc')
      .limit(limit)
      .execute()
    return rows
  })

  app.get('/api/admin/system', staff, async () => {
    const t0 = Date.now()
    await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
    const server =
      ctx.client === 'postgres'
        ? `${ctx.cfg.postgres.host}:${ctx.cfg.postgres.port}`
        : ctx.client === 'mssql'
          ? `${ctx.cfg.mssql.server}${ctx.cfg.mssql.instance ? '\\' + ctx.cfg.mssql.instance : ':' + ctx.cfg.mssql.port}`
          : ctx.cfg.sqlitePath
    const database = ctx.client === 'postgres' ? ctx.cfg.postgres.database : ctx.client === 'mssql' ? ctx.cfg.mssql.database : 'sqlite'
    return {
      db: ctx.client,
      dbLatencyMs: Date.now() - t0,
      server,
      database,
      timezone: ctx.cfg.timezone,
      wsClients: ctx.hub.size,
      hub: ctx.hub.mode,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      version: ctx.cfg.version,
    }
  })
}
