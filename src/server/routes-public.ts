import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loadUser, openSession } from './auth.js'
import type { Ctx } from './db.js'
import { nowIso } from './db.js'
import { HttpError } from './errors.js'
import { createTicket, tvState } from './queue.js'
import { RateLimiter, hashPassword, sha256, verifyPassword } from './security.js'
import { getSettings, publicSettings } from './settings.js'

const loginLimiter = new RateLimiter()
const ticketLimiter = new RateLimiter()
const pinLimiter = new RateLimiter()
const DUMMY_HASH = await hashPassword('dummy-password-for-timing')

export function publicRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/health', async () => {
    await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
    return { ok: true, db: ctx.client, time: nowIso() }
  })

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }).parse(req.body)
    const uname = username.trim().toLowerCase()
    if (!loginLimiter.hit(`${req.ip}|${uname}`, 8, 10 * 60_000)) throw new HttpError(429, 'Demasiados intentos. Esperá unos minutos.')
    const u = await ctx.db.selectFrom('users').selectAll().where('username', '=', uname).where('active', '=', 1).executeTakeFirst()
    const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH)
    if (!u || !ok) throw new HttpError(401, 'Usuario o contraseña incorrectos')
    await openSession(ctx, reply, u.id)
    return { id: u.id, username: u.username, displayName: u.display_name, role: u.role, sectorId: u.sector_id, desk: u.desk }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.cookies?.sid) await ctx.db.deleteFrom('sessions').where('token_hash', '=', sha256(req.cookies.sid)).execute()
    reply.clearCookie('sid', { path: '/' })
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
    const { current, next } = z.object({ current: z.string().min(1), next: z.string().min(8, 'La contraseña nueva debe tener al menos 8 caracteres').max(200) }).parse(req.body)
    const row = await ctx.db.selectFrom('users').select('password_hash').where('id', '=', u.id).executeTakeFirstOrThrow()
    if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta')
    await ctx.db.updateTable('users').set({ password_hash: await hashPassword(next) }).where('id', '=', u.id).execute()
    return { ok: true }
  })

  app.get('/api/public/sectors', async () => {
    const sectors = await ctx.db.selectFrom('sectors').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('name').execute()
    const buttons = await ctx.db.selectFrom('buttons').innerJoin('sectors as t', 't.id', 'buttons.target_sector_id').selectAll('buttons')
      .where('buttons.active', '=', 1).where('t.active', '=', 1).orderBy('buttons.sort_order').orderBy('buttons.id').execute()
    const s = await getSettings(ctx)
    return {
      settings: publicSettings(s),
      sectors: sectors.map((x) => ({
        id: x.id, name: x.name, color: x.color, welcomeMessage: x.welcome_message,
        buttons: buttons.filter((b) => b.sector_id === x.id).map((b) => ({ id: b.id, label: b.label, subtitle: b.subtitle, color: b.color ?? x.color })),
      })),
    }
  })

  app.post('/api/public/tickets', async (req) => {
    if (!ticketLimiter.hit(req.ip, 40, 60_000)) throw new HttpError(429, 'Demasiados turnos en poco tiempo')
    const { buttonId } = z.object({ buttonId: z.number().int().positive() }).parse(req.body)
    return createTicket(ctx, buttonId)
  })

  app.post('/api/public/totem-pin', async (req) => {
    if (!pinLimiter.hit(req.ip, 10, 5 * 60_000)) throw new HttpError(429, 'Demasiados intentos')
    const { pin } = z.object({ pin: z.string().max(12) }).parse(req.body)
    return { ok: pin === (await getSettings(ctx)).totem_pin }
  })

  app.get('/api/public/tv', async (req) => {
    const ids = String((req.query as any)?.sectors ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)
    return tvState(ctx, ids)
  })
}
