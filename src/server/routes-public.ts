import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loadUser, openSession } from './auth.js'
import type { Ctx } from './db.js'
import { insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { createTicket, tvState } from './queue.js'
import { RateLimiter, hashPassword, verifyPassword } from './security.js'
import { getSettings, publicSettings } from './settings.js'
import { audit } from './audit.js'

const ticketLimiter = new RateLimiter()
const pinLimiter = new RateLimiter()

export function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/health', async () => {
    const t0 = Date.now()
    let dbOk = false
    try {
      await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
      dbOk = true
    } catch {}
    return {
      ok: dbOk,
      db: ctx.client,
      dbLatencyMs: Date.now() - t0,
      wsClients: ctx.hub.size,
      uptimeSec: Math.round(process.uptime()),
      version: '1.1.0',
    }
  })

  app.get('/api/openapi.json', async () => ({
    openapi: '3.0.3',
    info: { title: 'CELTTO-TOTEMS API', version: '1.1.0' },
    paths: {
      '/api/health': { get: { summary: 'Healthcheck' } },
      '/api/public/tickets': { post: { summary: 'Crear turno desde tótem' } },
      '/api/public/tv': { get: { summary: 'Estado de pantalla TV' } },
      '/api/public/stations/bind': { post: { summary: 'Vincular tótem o TV a secretaría' } },
      '/api/admin/stats': { get: { summary: 'Estadísticas y reportes' } },
    },
  }))

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body)
    const user = await ctx.db
      .selectFrom('users')
      .selectAll()
      .where('username', '=', body.username.toLowerCase())
      .where('active', '=', 1)
      .executeTakeFirst()
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      await audit(ctx, { action: 'login.fail', detail: { username: body.username }, ip: req.ip })
      throw new HttpError(401, 'Usuario o contraseña incorrectos')
    }
    await openSession(ctx, reply, user.id)
    await audit(ctx, { userId: user.id, action: 'login.ok', ip: req.ip })
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      sectorId: user.sector_id,
      deskId: user.desk_id,
      desk: user.desk,
    }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const u = await loadUser(ctx, req)
    reply.clearCookie('sid', { path: '/' })
    if (u) await audit(ctx, { userId: u.id, action: 'logout', ip: req.ip })
    return { ok: true }
  })

  app.get('/api/auth/me', async (req) => {
    const u = await loadUser(ctx, req)
    if (!u) throw new HttpError(401, 'Sin sesión')
    return u
  })

  app.put('/api/auth/password', async (req) => {
    const u = await loadUser(ctx, req)
    if (!u) throw new HttpError(401, 'Sin sesión')
    const { current, next } = z
      .object({ current: z.string().min(1), next: z.string().min(8).max(200) })
      .parse(req.body)
    const row = await ctx.db.selectFrom('users').select('password_hash').where('id', '=', u.id).executeTakeFirstOrThrow()
    if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta')
    await ctx.db.updateTable('users').set({ password_hash: await hashPassword(next) }).where('id', '=', u.id).execute()
    return { ok: true }
  })

  app.get('/api/public/sectors', async () => {
    const sectors = await ctx.db.selectFrom('sectors').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
    const buttons = await ctx.db
      .selectFrom('buttons')
      .innerJoin('sectors as t', 't.id', 'buttons.target_sector_id')
      .selectAll('buttons')
      .where('buttons.active', '=', 1)
      .where('t.active', '=', 1)
      .orderBy('buttons.sort_order')
      .orderBy('buttons.id')
      .execute()
    const s = await getSettings(ctx)
    return {
      settings: publicSettings(s),
      sectors: sectors.map((x) => ({
        id: x.id,
        name: x.name,
        color: x.color,
        welcomeMessage: x.welcome_message,
        buttons: buttons
          .filter((b) => b.sector_id === x.id)
          .map((b) => ({
            id: b.id,
            label: b.label,
            subtitle: b.subtitle,
            color: b.color ?? x.color,
            priorityId: b.priority_id,
            priority: b.priority,
          })),
      })),
    }
  })

  app.post('/api/public/tickets', async (req) => {
    if (!ticketLimiter.hit(req.ip, 40, 60_000)) throw new HttpError(429, 'Demasiados turnos en poco tiempo')
    const { buttonId } = z.object({ buttonId: z.number().int().positive() }).parse(req.body)
    return createTicket(ctx, buttonId)
  })

  app.post('/api/public/tickets/:id/reprint', async (req) => {
    const id = z.coerce.number().int().positive().parse((req.params as any).id)
    const t = await ctx.db.selectFrom('tickets').selectAll().where('id', '=', id).executeTakeFirst()
    if (!t) throw new HttpError(404, 'Turno no encontrado')
    await ctx.db
      .updateTable('tickets')
      .set({ print_count: (t.print_count ?? 0) + 1 })
      .where('id', '=', id)
      .execute()
    const sector = await ctx.db.selectFrom('sectors').select(['name', 'color']).where('id', '=', t.sector_id).executeTakeFirst()
    const settings = await getSettings(ctx)
    return {
      id: t.id,
      code: t.code,
      sectorName: sector?.name,
      color: sector?.color,
      footer: settings.ticket_footer,
      printCount: (t.print_count ?? 0) + 1,
      createdAt: t.created_at,
    }
  })

  app.post('/api/public/totem-pin', async (req) => {
    if (!pinLimiter.hit(req.ip, 10, 5 * 60_000)) throw new HttpError(429, 'Demasiados intentos')
    const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body)
    return { ok: pin === (await getSettings(ctx)).totem_pin }
  })

  app.post('/api/public/stations/bind', async (req) => {
    const b = z
      .object({
        kind: z.enum(['totem', 'tv']),
        deviceKey: z.string().min(8).max(64),
        sectorId: z.number().int().positive(),
        pin: z.string().max(12),
        name: z.string().trim().min(1).max(100).optional(),
      })
      .parse(req.body)
    const settings = await getSettings(ctx)
    if (b.pin !== settings.totem_pin) throw new HttpError(403, 'PIN incorrecto')
    const sector = await ctx.db
      .selectFrom('sectors')
      .select(['id', 'name'])
      .where('id', '=', b.sectorId)
      .where('active', '=', 1)
      .executeTakeFirst()
    if (!sector) throw new HttpError(404, 'Secretaría no encontrada')
    const existing = await ctx.db.selectFrom('stations').selectAll().where('device_key', '=', b.deviceKey).executeTakeFirst()
    if (existing) {
      await ctx.db
        .updateTable('stations')
        .set({
          sector_id: b.sectorId,
          kind: b.kind,
          name: b.name ?? existing.name,
          last_seen_at: nowIso(),
          active: 1,
        })
        .where('id', '=', existing.id)
        .execute()
      ctx.hub.broadcast({ type: 'config' })
      return { id: existing.id, deviceKey: existing.device_key, sectorId: b.sectorId, sectorName: sector.name }
    }
    const id = await insertId(ctx, ctx.db, 'stations', {
      kind: b.kind,
      name: b.name ?? `${b.kind}-${sector.name}`,
      sector_id: b.sectorId,
      device_key: b.deviceKey,
      active: 1,
      last_seen_at: nowIso(),
      created_at: nowIso(),
    })
    ctx.hub.broadcast({ type: 'config' })
    return { id, deviceKey: b.deviceKey, sectorId: b.sectorId, sectorName: sector.name }
  })

  app.get('/api/public/stations/:deviceKey', async (req) => {
    const deviceKey = z.string().min(8).max(64).parse((req.params as any).deviceKey)
    const st = await ctx.db
      .selectFrom('stations')
      .leftJoin('sectors', 'sectors.id', 'stations.sector_id')
      .select([
        'stations.id',
        'stations.kind',
        'stations.name',
        'stations.sector_id',
        'stations.device_key',
        'stations.active',
        'sectors.name as sector_name',
        'sectors.color as sector_color',
      ])
      .where('stations.device_key', '=', deviceKey)
      .where('stations.active', '=', 1)
      .executeTakeFirst()
    if (!st) throw new HttpError(404, 'Estación no registrada')
    await ctx.db.updateTable('stations').set({ last_seen_at: nowIso() }).where('id', '=', st.id).execute()
    return {
      id: st.id,
      kind: st.kind,
      name: st.name,
      sectorId: st.sector_id,
      sectorName: st.sector_name,
      sectorColor: st.sector_color,
      deviceKey: st.device_key,
    }
  })

  app.get('/api/public/tv', async (req) => {
    const q = req.query as any
    let ids = String(q?.sectors ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
    const deviceKey = q?.deviceKey ? String(q.deviceKey) : ''
    if (deviceKey) {
      const st = await ctx.db
        .selectFrom('stations')
        .select(['sector_id', 'kind'])
        .where('device_key', '=', deviceKey)
        .where('active', '=', 1)
        .executeTakeFirst()
      if (st?.kind === 'tv' && st.sector_id) ids = [st.sector_id]
      if (st) await ctx.db.updateTable('stations').set({ last_seen_at: nowIso() }).where('device_key', '=', deviceKey).execute()
    }
    return tvState(ctx, ids)
  })
}
