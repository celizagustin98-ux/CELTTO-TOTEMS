import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { closeOtherSessions, closeSession, loadUser, openSession } from './auth.js'
import type { Ctx } from './db.js'
import { businessDate, insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { createTicket, ticketStatus, tvState } from './queue.js'
import { RateLimiter, getDummyHash, hashPassword, safeEqual, verifyPassword } from './security.js'
import { getSettings, publicSettings } from './settings.js'
import { audit } from './audit.js'
import { documentSchema, findPatient, greetingName, patientInput } from './patients.js'

const LOGIN_MAX_PER_USER = 8
const LOGIN_MAX_PER_IP = 30
const LOGIN_WINDOW_MS = 15 * 60_000

export function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  const ticketLimiter = new RateLimiter(ctx.hub.counters, 'ticket')
  const pinLimiter = new RateLimiter(ctx.hub.counters, 'pin')
  const loginLimiter = new RateLimiter(ctx.hub.counters, 'login')
  const reprintLimiter = new RateLimiter(ctx.hub.counters, 'reprint')
  const lookupLimiter = new RateLimiter(ctx.hub.counters, 'lookup')

  app.get('/api/health', async (req, reply) => {
    const t0 = Date.now()
    let dbOk = true
    try {
      await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
    } catch (e) {
      dbOk = false
      req.log.error({ err: e }, 'health: base de datos no disponible')
    }
    if (!dbOk) reply.code(503)
    return { ok: dbOk, dbLatencyMs: Date.now() - t0, version: ctx.cfg.version }
  })

  app.get('/api/public/version', async () => ({ version: ctx.cfg.version }))

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) }).parse(req.body)
    const username = body.username.toLowerCase()
    const okUser = await loginLimiter.hit(`u:${username}`, LOGIN_MAX_PER_USER, LOGIN_WINDOW_MS)
    const okIp = await loginLimiter.hit(`ip:${req.ip}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS)
    if (!okUser || !okIp) {
      await audit(ctx, { action: 'login.blocked', detail: { username }, ip: req.ip })
      throw new HttpError(429, 'Demasiados intentos. Esperá 15 minutos o pedile al administrador que revise tu usuario.')
    }
    const user = await ctx.db.selectFrom('users').selectAll().where('username', '=', username).where('active', '=', 1).executeTakeFirst()
    // Siempre se verifica un hash (aunque el usuario no exista) para no revelar qué usuarios existen por el tiempo de respuesta
    const valid = await verifyPassword(body.password, user?.password_hash ?? (await getDummyHash()))
    if (!user || !valid) {
      await audit(ctx, { action: 'login.fail', detail: { username }, ip: req.ip })
      throw new HttpError(401, 'Usuario o contraseña incorrectos')
    }
    await loginLimiter.reset(`u:${username}`)
    await openSession(ctx, reply, user.id)
    await ctx.db.updateTable('users').set({ last_login_at: nowIso() }).where('id', '=', user.id).execute()
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
    await closeSession(ctx, req, reply)
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
    const { current, next } = z.object({ current: z.string().min(1).max(200), next: z.string().min(8, 'La contraseña nueva debe tener al menos 8 caracteres').max(200) }).parse(req.body)
    if (!(await loginLimiter.hit(`pw:${u.id}`, 5, LOGIN_WINDOW_MS))) throw new HttpError(429, 'Demasiados intentos. Esperá unos minutos.')
    const row = await ctx.db.selectFrom('users').select('password_hash').where('id', '=', u.id).executeTakeFirstOrThrow()
    if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta')
    await ctx.db.updateTable('users').set({ password_hash: await hashPassword(next) }).where('id', '=', u.id).execute()
    // Al cambiar la clave se cierran las demás sesiones abiertas (otras PCs / celulares)
    await closeOtherSessions(ctx, u.id, req.cookies?.sid)
    await audit(ctx, { userId: u.id, action: 'password.change', ip: req.ip })
    return { ok: true }
  })

  app.get('/api/public/sectors', async () => {
    const sectors = await ctx.db.selectFrom('sectors').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
    const buttons = await ctx.db
      .selectFrom('buttons')
      .innerJoin('sectors as t', 't.id', 'buttons.target_sector_id')
      .leftJoin('priorities as p', 'p.id', 'buttons.priority_id')
      .selectAll('buttons')
      .select(['p.name as priority_name', 'p.color as priority_color'])
      .where('buttons.active', '=', 1)
      .where('t.active', '=', 1)
      .orderBy('buttons.sort_order')
      .orderBy('buttons.id')
      .execute()
    const s = await getSettings(ctx)
    const logo = await ctx.db.selectFrom('assets').select('updated_at').where('asset_key', '=', 'logo').executeTakeFirst()
    const media = await ctx.db.selectFrom('assets').select(['asset_key', 'updated_at']).where('asset_key', 'like', 'media:%').execute()
    return {
      settings: publicSettings(s),
      logoVersion: logo?.updated_at ?? null,
      mediaCount: media.length,
      sectors: sectors.map((x) => ({
        id: x.id,
        name: x.name,
        color: x.color,
        welcomeMessage: x.welcome_message,
        buttons: buttons
          .filter((b) => b.sector_id === x.id && (s.priorities_enabled || b.priority <= 0))
          .map((b) => ({
            id: b.id,
            label: b.label,
            subtitle: b.subtitle,
            color: b.color ?? x.color,
            icon: b.icon,
            priorityName: s.priorities_enabled && b.priority > 0 ? b.priority_name : null,
            priority: b.priority,
          })),
      })),
    }
  })

  app.get('/api/public/logo', async (_req, reply) => {
    const a = await ctx.db.selectFrom('assets').selectAll().where('asset_key', '=', 'logo').executeTakeFirst()
    if (!a) throw new HttpError(404, 'Sin logo')
    reply.header('Content-Type', a.mime)
    reply.header('Cache-Control', 'public, max-age=300')
    reply.header('Content-Security-Policy', "default-src 'none'")
    return Buffer.from(a.data, 'base64')
  })

  // El tótem consulta si el documento ya está registrado. Solo devuelve un saludo abreviado (nunca datos completos).
  app.post('/api/public/patients/lookup', async (req) => {
    const b = z.object({ document: documentSchema, deviceKey: z.string().min(4).max(64).optional() }).parse(req.body)
    if (!(await lookupLimiter.hit(`ip:${req.ip}`, 120, 60_000)) || (b.deviceKey && !(await lookupLimiter.hit(`dev:${b.deviceKey}`, 40, 60_000))))
      throw new HttpError(429, 'Demasiadas consultas. Esperá un momento.')
    const p = await findPatient(ctx, b.document)
    return p ? { found: true, greeting: greetingName(p.first_name, p.last_name) } : { found: false }
  })

  app.post('/api/public/tickets', async (req) => {
    const body = z
      .object({
        buttonId: z.number().int().positive(),
        deviceKey: z.string().min(4).max(64).optional(),
        patient: patientInput.optional(),
      })
      .parse(req.body)
    if (!(await ticketLimiter.hit(`ip:${req.ip}`, ctx.cfg.ticketRatePerMinute, 60_000))) {
      throw new HttpError(429, 'Demasiados turnos desde esta red. Esperá un momento.')
    }
    if (body.deviceKey && !(await ticketLimiter.hit(`dev:${body.deviceKey}`, ctx.cfg.ticketRatePerDevice, 60_000))) {
      throw new HttpError(429, 'Este tótem emitió demasiados turnos. Esperá un momento.')
    }
    return createTicket(ctx, body.buttonId, body.patient)
  })

  // Imágenes de publicidad subidas desde el panel (se muestran en la TV)
  app.get('/api/public/media/:key', async (req, reply) => {
    const key = z.string().regex(/^[a-z0-9]{6,40}$/).parse((req.params as any).key)
    const a = await ctx.db.selectFrom('assets').selectAll().where('asset_key', '=', `media:${key}`).executeTakeFirst()
    if (!a) throw new HttpError(404, 'No encontrado')
    reply.header('Content-Type', a.mime)
    reply.header('Cache-Control', 'public, max-age=86400, immutable')
    reply.header('Content-Security-Policy', "default-src 'none'")
    return Buffer.from(a.data, 'base64')
  })

  // Reimpresión: solo turnos de hoy, con límite, para que no se pueda recorrer el historial
  app.post('/api/public/tickets/:id/reprint', async (req) => {
    const id = z.coerce.number().int().positive().parse((req.params as any).id)
    if (!(await reprintLimiter.hit(req.ip, 20, 60_000))) throw new HttpError(429, 'Demasiadas reimpresiones. Esperá un momento.')
    const t = await ctx.db
      .selectFrom('tickets')
      .selectAll()
      .where('id', '=', id)
      .where('business_date', '=', businessDate(ctx.cfg.timezone))
      .where('status', 'in', ['waiting', 'called', 'serving'])
      .executeTakeFirst()
    if (!t) throw new HttpError(404, 'Turno no encontrado')
    await ctx.db.updateTable('tickets').set({ print_count: (t.print_count ?? 0) + 1 }).where('id', '=', id).execute()
    return { id: t.id, code: t.code, printCount: (t.print_count ?? 0) + 1 }
  })

  app.post('/api/public/totem-pin', async (req) => {
    if (!(await pinLimiter.hit(req.ip, 10, 5 * 60_000))) throw new HttpError(429, 'Demasiados intentos. Esperá 5 minutos.')
    const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body)
    return { ok: safeEqual(pin, (await getSettings(ctx)).totem_pin) }
  })

  app.post('/api/public/stations/bind', async (req) => {
    if (!(await pinLimiter.hit(req.ip, 10, 5 * 60_000))) throw new HttpError(429, 'Demasiados intentos. Esperá 5 minutos.')
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
    if (!safeEqual(b.pin, settings.totem_pin)) {
      await audit(ctx, { action: 'station.bind.fail', ip: req.ip })
      throw new HttpError(403, 'PIN incorrecto')
    }
    const sector = await ctx.db.selectFrom('sectors').select(['id', 'name']).where('id', '=', b.sectorId).where('active', '=', 1).executeTakeFirst()
    if (!sector) throw new HttpError(404, 'Secretaría no encontrada')
    const existing = await ctx.db.selectFrom('stations').selectAll().where('device_key', '=', b.deviceKey).executeTakeFirst()
    let id: number
    if (existing) {
      await ctx.db
        .updateTable('stations')
        .set({ sector_id: b.sectorId, kind: b.kind, name: b.name ?? existing.name, last_seen_at: nowIso(), active: 1 })
        .where('id', '=', existing.id)
        .execute()
      id = existing.id
    } else {
      id = await insertId(ctx, ctx.db, 'stations', {
        kind: b.kind,
        name: b.name ?? `${b.kind}-${sector.name}`,
        sector_id: b.sectorId,
        device_key: b.deviceKey,
        active: 1,
        last_seen_at: nowIso(),
        lang: null,
        created_at: nowIso(),
      })
    }
    await audit(ctx, { action: 'station.bind', entity: 'station', entityId: id, ip: req.ip })
    ctx.hub.broadcast({ type: 'config' })
    return { id, sectorId: b.sectorId, sectorName: sector.name }
  })

  app.get('/api/public/stations/:deviceKey', async (req) => {
    const deviceKey = z.string().min(8).max(64).parse((req.params as any).deviceKey)
    const st = await ctx.db
      .selectFrom('stations')
      .leftJoin('sectors', 'sectors.id', 'stations.sector_id')
      .select(['stations.id', 'stations.kind', 'stations.name', 'stations.sector_id', 'stations.lang', 'sectors.name as sector_name', 'sectors.color as sector_color'])
      .where('stations.device_key', '=', deviceKey)
      .where('stations.active', '=', 1)
      .executeTakeFirst()
    if (!st) throw new HttpError(404, 'Estación no registrada')
    await ctx.db.updateTable('stations').set({ last_seen_at: nowIso() }).where('id', '=', st.id).execute()
    return { id: st.id, kind: st.kind, name: st.name, sectorId: st.sector_id, sectorName: st.sector_name, sectorColor: st.sector_color, lang: st.lang }
  })

  app.get('/api/public/tv', async (req) => {
    const q = req.query as Record<string, unknown>
    let ids = String(q?.sectors ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 50)
    const deviceKey = typeof q?.deviceKey === 'string' ? q.deviceKey.slice(0, 64) : ''
    if (deviceKey) {
      const st = await ctx.db.selectFrom('stations').select(['id', 'sector_id', 'kind']).where('device_key', '=', deviceKey).where('active', '=', 1).executeTakeFirst()
      if (st?.kind === 'tv' && st.sector_id) ids = [st.sector_id]
      if (st) await ctx.db.updateTable('stations').set({ last_seen_at: nowIso() }).where('id', '=', st.id).execute()
    }
    return tvState(ctx, ids)
  })

  app.get('/api/public/ticket/:code', async (req) => {
    const code = z.string().min(1).max(12).regex(/^[A-Za-z0-9-]+$/).parse((req.params as any).code).toUpperCase()
    return ticketStatus(ctx, code)
  })
}
