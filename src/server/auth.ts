import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Ctx } from './db.js'
import { nowIso } from './db.js'
import { HttpError } from './errors.js'
import { newToken, sha256 } from './security.js'
import type { AuthUser, UserRole } from './types.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null
  }
}

export const ROLES: UserRole[] = ['owner', 'admin', 'tech', 'secretary']
/** Quién entra al panel maestro (lectura). */
export const STAFF_ROLES: UserRole[] = ['owner', 'admin', 'tech']
/** Quién puede modificar la configuración del sistema. */
export const MANAGER_ROLES: UserRole[] = ['owner', 'admin']

export async function loadUser(ctx: Ctx, req: FastifyRequest): Promise<AuthUser | null> {
  const sid = req.cookies?.sid
  if (!sid || sid.length > 200) return null
  const r = await ctx.db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['users.id', 'users.username', 'users.display_name', 'users.role', 'users.sector_id', 'users.desk', 'users.desk_id'])
    .where('sessions.token_hash', '=', sha256(sid))
    .where('sessions.expires_at', '>', nowIso())
    .where('users.active', '=', 1)
    .executeTakeFirst()
  return r
    ? {
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        role: r.role as UserRole,
        sectorId: r.sector_id,
        deskId: r.desk_id,
        desk: r.desk,
      }
    : null
}

export const requireRole = (ctx: Ctx, ...roles: UserRole[]) => async (req: FastifyRequest, _reply: FastifyReply) => {
  const u = await loadUser(ctx, req)
  if (!u) throw new HttpError(401, 'Iniciá sesión para continuar')
  if (!roles.includes(u.role)) throw new HttpError(403, 'No tenés permiso para esta acción')
  req.user = u
}

export const requireStaff = (ctx: Ctx) => requireRole(ctx, ...STAFF_ROLES)

export async function openSession(ctx: Ctx, reply: FastifyReply, userId: number) {
  const token = newToken()
  const now = Date.now()
  await ctx.db
    .insertInto('sessions')
    .values({
      token_hash: sha256(token),
      user_id: userId,
      expires_at: new Date(now + ctx.cfg.sessionHours * 3600_000).toISOString(),
      created_at: new Date(now).toISOString(),
    })
    .execute()
  reply.setCookie('sid', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: ctx.cfg.cookieSecure,
    maxAge: ctx.cfg.sessionHours * 3600,
    signed: false,
  })
}

/** Borra la sesión actual de la base (no solo la cookie). */
export async function closeSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply) {
  const sid = req.cookies?.sid
  if (sid) await ctx.db.deleteFrom('sessions').where('token_hash', '=', sha256(sid)).execute()
  reply.clearCookie('sid', { path: '/' })
}

/** Cierra todas las sesiones de un usuario salvo (opcionalmente) la actual. */
export async function closeOtherSessions(ctx: Ctx, userId: number, keepSid?: string) {
  let q = ctx.db.deleteFrom('sessions').where('user_id', '=', userId)
  if (keepSid) q = q.where('token_hash', '!=', sha256(keepSid))
  await q.execute()
}

export async function purgeExpiredSessions(ctx: Ctx) {
  const r = await ctx.db.deleteFrom('sessions').where('expires_at', '<=', nowIso()).executeTakeFirst()
  return Number(r.numDeletedRows ?? 0)
}
