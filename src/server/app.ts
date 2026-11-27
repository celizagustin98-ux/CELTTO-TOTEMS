import { existsSync } from 'node:fs'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { ZodError } from 'zod'
import { adminRoutes } from './routes-admin.js'
import { deskRoutes } from './routes-desk.js'
import { publicRoutes } from './routes-public.js'
import type { Ctx } from './db.js'
import { HttpError } from './errors.js'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** El navegador manda Origin en el WebSocket: solo aceptamos el mismo host que sirve la app. */
function sameOrigin(origin: string | undefined, host: string | undefined) {
  if (!origin) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function buildApp(ctx: Ctx) {
  const opts: FastifyServerOptions = {
    // Los errores se registran siempre; LOG_HTTP solo activa el log de cada petición
    logger: { level: ctx.cfg.logger ? 'info' : 'warn' },
    // Solo confiar en X-Forwarded-For si hay un proxy delante (Caddy). Si no, cualquiera podría falsear su IP.
    trustProxy: typeof ctx.cfg.trustProxy === 'number' ? (hops => (_addr: string, i: number) => i < hops)(ctx.cfg.trustProxy) : ctx.cfg.trustProxy,
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
  }
  const app = Fastify(opts)

  app.addHook('onRequest', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header('X-DNS-Prefetch-Control', 'off')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    reply.header('Content-Security-Policy', CSP)
    if (ctx.cfg.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  })
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    return payload
  })

  await app.register(cookie, { secret: ctx.cfg.sessionSecret, hook: 'onRequest' })
  await app.register(websocket, { options: { maxPayload: 4096 } })

  app.decorateRequest('user', null)

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {})
    } catch (e) {
      done(Object.assign(e as Error, { statusCode: 400, message: 'JSON inválido' }))
    }
  })

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message })
    if (err instanceof ZodError)
      return reply.code(400).send({
        error: err.issues[0]?.message ?? 'Datos inválidos',
        details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      })
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message })
    req.log.error(err)
    return reply.code(500).send({ error: 'Error interno del servidor' })
  })

  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!sameOrigin(req.headers.origin, req.headers.host) || !ctx.hub.add(socket, req.ip)) {
      socket.close(1008, 'No permitido')
      return
    }
    socket.on('message', () => {
      /* el canal es solo de servidor a cliente */
    })
    socket.send(JSON.stringify({ type: 'hello' }))
  })
  publicRoutes(app, ctx)
  deskRoutes(app, ctx)
  adminRoutes(app, ctx)

  if (existsSync(ctx.cfg.webDir)) {
    await app.register(fastifyStatic, {
      root: ctx.cfg.webDir,
      wildcard: false,
      index: false,
      setHeaders(res, path) {
        res.header('X-Content-Type-Options', 'nosniff')
        // Los archivos con hash en el nombre se cachean para siempre; el index.html nunca (si no, tras actualizar quedan con la versión vieja)
        res.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
    const sendIndex = (_req: unknown, reply: any) => reply.header('Cache-Control', 'no-cache').sendFile('index.html')
    app.get('/', sendIndex)
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.code(404).send({ error: 'No encontrado' })
      return sendIndex(req, reply)
    })
  }
  return app
}
