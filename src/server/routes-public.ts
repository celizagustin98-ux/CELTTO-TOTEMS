import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { closeOtherSessions, closeSession, loadUser, mfaRequired, openSession } from './auth.js'
import { newBackupCodes, newTotpSecret, otpauthUrl, useBackupCode, verifyTotp } from './totp.js'
import { newToken, sha256 } from './security.js'
import { can } from './permissions.js'
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
    // Con doble factor activo, la contraseña sola no alcanza: se pide el código del celular
    if (user.totp_enabled === 1) {
      const token = newToken()
      await ctx.db.insertInto('auth_challenges').values({ token_hash: sha256(token), user_id: user.id, attempts: 0, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() }).execute()
      return { mfaRequired: true, challenge: token }
    }
    return finishLogin(req, reply, user.id)
  })

  const finishLogin = async (req: any, reply: any, userId: number) => {
    await openSession(ctx, reply, userId)
    await ctx.db.updateTable('users').set({ last_login_at: nowIso() }).where('id', '=', userId).execute()
    await audit(ctx, { userId, action: 'login.ok', ip: req.ip })
    const u = await ctx.db.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow()
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      sectorId: u.sector_id,
      deskId: u.desk_id,
      desk: u.desk,
      mfaEnabled: u.totp_enabled === 1,
      mfaSetupRequired: u.totp_enabled !== 1 && (await mfaRequired(ctx, u.role as any)),
    }
  }

  /** Segundo paso del login: código de 6 dígitos o un código de respaldo. */
  app.post('/api/auth/mfa', async (req, reply) => {
    const b = z.object({ challenge: z.string().min(10).max(200), code: z.string().trim().min(6).max(20) }).parse(req.body)
    if (!(await loginLimiter.hit(`mfa:${req.ip}`, 20, LOGIN_WINDOW_MS))) throw new HttpError(429, 'Demasiados intentos. Esperá unos minutos.')
    const ch = await ctx.db.selectFrom('auth_challenges').selectAll().where('token_hash', '=', sha256(b.challenge)).where('expires_at', '>', nowIso()).executeTakeFirst()
    if (!ch) throw new HttpError(401, 'El código venció. Volvé a ingresar usuario y contraseña.')
    if (ch.attempts >= 5) {
      await ctx.db.deleteFrom('auth_challenges').where('token_hash', '=', ch.token_hash).execute()
      throw new HttpError(401, 'Demasiados códigos incorrectos. Volvé a ingresar usuario y contraseña.')
    }
    const u = await ctx.db.selectFrom('users').select(['id', 'totp_secret_enc', 'totp_backup', 'active']).where('id', '=', ch.user_id).executeTakeFirstOrThrow()
    const secret = ctx.crypto.decrypt(u.totp_secret_enc)
    let ok = !!secret && verifyTotp(secret, b.code)
    if (!ok) {
      const rest = useBackupCode(u.totp_backup, b.code)
      if (rest) {
        ok = true
        await ctx.db.updateTable('users').set({ totp_backup: JSON.stringify(rest) }).where('id', '=', u.id).execute()
        await audit(ctx, { userId: u.id, action: 'mfa.backup_used', detail: { left: rest.length }, ip: req.ip })
      }
    }
    if (!ok || u.active !== 1) {
      await ctx.db.updateTable('auth_challenges').set({ attempts: ch.attempts + 1 }).where('token_hash', '=', ch.token_hash).execute()
      await audit(ctx, { userId: u.id, action: 'mfa.fail', ip: req.ip })
      throw new HttpError(401, 'Código incorrecto')
    }
    await ctx.db.deleteFrom('auth_challenges').where('token_hash', '=', ch.token_hash).execute()
    return finishLogin(req, reply, u.id)
  })

  /** Paso 1 de la activación: genera el secreto y la dirección para el QR (todavía no queda activo). */
  app.post('/api/auth/mfa/setup', async (req) => {
    const me = await loadUser(ctx, req)
    if (!me) throw new HttpError(401, 'Sin sesión')
    const secret = newTotpSecret()
    await ctx.db.updateTable('users').set({ totp_pending_enc: ctx.crypto.encrypt(secret) }).where('id', '=', me.id).execute()
    const org = (await getSettings(ctx)).org_name
    return { secret, otpauth: otpauthUrl(secret, me.username, `CELTTO · ${org}`) }
  })

  /** Paso 2: confirma con un código y activa. Devuelve los códigos de respaldo (se muestran una sola vez). */
  app.post('/api/auth/mfa/enable', async (req) => {
    const me = await loadUser(ctx, req)
    if (!me) throw new HttpError(401, 'Sin sesión')
    const { code } = z.object({ code: z.string().trim().length(6) }).parse(req.body)
    const row = await ctx.db.selectFrom('users').select('totp_pending_enc').where('id', '=', me.id).executeTakeFirstOrThrow()
    const secret = ctx.crypto.decrypt(row.totp_pending_enc)
    if (!secret || !verifyTotp(secret, code)) throw new HttpError(400, 'El código no coincide. Revisá la hora del celular y probá de nuevo.')
    const backup = newBackupCodes()
    await ctx.db
      .updateTable('users')
      .set({ totp_secret_enc: ctx.crypto.encrypt(secret), totp_pending_enc: null, totp_enabled: 1, totp_backup: JSON.stringify(backup.hashes) })
      .where('id', '=', me.id)
      .execute()
    await closeOtherSessions(ctx, me.id, req.cookies?.sid)
    await audit(ctx, { userId: me.id, action: 'mfa.enable', ip: req.ip })
    return { ok: true, backupCodes: backup.codes }
  })

  app.post('/api/auth/mfa/disable', async (req) => {
    const me = await loadUser(ctx, req)
    if (!me) throw new HttpError(401, 'Sin sesión')
    const b = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(20) }).parse(req.body)
    if (await mfaRequired(ctx, me.role)) throw new HttpError(400, 'Tu rol exige doble factor: no se puede desactivar')
    const row = await ctx.db.selectFrom('users').select(['password_hash', 'totp_secret_enc']).where('id', '=', me.id).executeTakeFirstOrThrow()
    const secret = ctx.crypto.decrypt(row.totp_secret_enc)
    if (!(await verifyPassword(b.password, row.password_hash)) || !secret || !verifyTotp(secret, b.code)) throw new HttpError(400, 'Contraseña o código incorrectos')
    await ctx.db.updateTable('users').set({ totp_enabled: 0, totp_secret_enc: null, totp_backup: null }).where('id', '=', me.id).execute()
    await audit(ctx, { userId: me.id, action: 'mfa.disable', ip: req.ip })
    return { ok: true }
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
    const { ROLE_PERMS } = await import('./permissions.js')
    return { ...u, permissions: ROLE_PERMS[u.role], mfaSetupRequired: !u.mfaEnabled && (await mfaRequired(ctx, u.role)), canAttend: can(u, 'desk.attend') }
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
    return {
      settings: publicSettings(s),
      logoVersion: logo?.updated_at ?? null,
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
            prefix: b.prefix,
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

  app.get('/api/public/ticket/:token', async (req) => {
    const token = z.string().regex(/^[A-Za-z0-9_-]{12,32}$/, 'Enlace inválido').parse((req.params as any).token)
    if (!(await lookupLimiter.hit(`t:${req.ip}`, 240, 60_000))) throw new HttpError(429, 'Demasiadas consultas. Esperá un momento.')
    return ticketStatus(ctx, token)
  })

  /**
   * Sincroniza los turnos que el tótem emitió sin conexión. Es idempotente (offline_ref): si el tótem
   * reintenta, no se duplican. Respeta la hora original para que entren a la cola en su orden real.
   */
  app.post('/api/public/tickets/offline-sync', async (req) => {
    const b = z
      .object({
        deviceKey: z.string().min(4).max(64),
        tickets: z
          .array(
            z.object({
              ref: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
              buttonId: z.number().int().positive(),
              code: z.string().regex(/^[A-Z0-9]{1,3}-T[0-9A-Z]{1,3}-\d{3}$/),
              createdAt: z.string().datetime(),
              patient: patientInput.optional(),
            }),
          )
          .max(200),
      })
      .parse(req.body)
    if (!(await ticketLimiter.hit(`sync:${b.deviceKey}`, 30, 60_000))) throw new HttpError(429, 'Demasiadas sincronizaciones. Esperá un momento.')
    const results: { ref: string; ok: boolean; code?: string; error?: string }[] = []
    const oldest = Date.now() - 24 * 3600_000
    for (const t of b.tickets) {
      const done = await ctx.db.selectFrom('tickets').select('code').where('offline_ref', '=', t.ref).executeTakeFirst()
      if (done) { results.push({ ref: t.ref, ok: true, code: done.code }); continue }
      const at = Date.parse(t.createdAt)
      if (at < oldest || at > Date.now() + 60_000) { results.push({ ref: t.ref, ok: false, error: 'Fecha fuera de rango' }); continue }
      try {
        const r = await createTicket(ctx, t.buttonId, t.patient, { ref: t.ref, code: t.code, createdAt: new Date(at).toISOString() })
        results.push({ ref: t.ref, ok: true, code: r.code })
      } catch (e) {
        // Paciente nuevo sin datos completos: se registra el turno sin identificar para no perderlo
        if ((e as Error).message === 'patient_not_found') {
          const r = await createTicket(ctx, t.buttonId, null, { ref: t.ref, code: t.code, createdAt: new Date(at).toISOString() }).catch((x) => x as Error)
          results.push(r instanceof Error ? { ref: t.ref, ok: false, error: r.message } : { ref: t.ref, ok: true, code: r.code })
        } else results.push({ ref: t.ref, ok: false, error: (e as Error).message })
      }
    }
    await audit(ctx, { action: 'totem.offline_sync', detail: { device: b.deviceKey.slice(0, 12), count: b.tickets.length, ok: results.filter((r) => r.ok).length }, ip: req.ip })
    return { results }
  })
}
