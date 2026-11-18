import { existsSync } from 'node:fs'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { adminRoutes } from './routes-admin.js'
import { deskRoutes } from './routes-desk.js'
import { publicRoutes } from './routes-public.js'
import type { Ctx } from './db.js'
import { HttpError } from './errors.js'

export async function buildApp(ctx: Ctx) {
  const app = Fastify({
    logger: ctx.cfg.logger,
    trustProxy: true,
    bodyLimit: 256 * 1024,
    requestIdHeader: 'x-request-id',
  })

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header('X-DNS-Prefetch-Control', 'off')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    if (ctx.cfg.cookieSecure) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    // No filtrar stack ni paths internos en errores
    reply.removeHeader('X-Powered-By')
  })

  await app.register(cookie, {
    secret: ctx.cfg.sessionSecret,
    hook: 'onRequest',
  })
  await app.register(websocket)

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

  app.get('/ws', { websocket: true }, (socket) => {
    ctx.hub.add(socket)
    socket.send(JSON.stringify({ type: 'hello' }))
  })
  publicRoutes(app, ctx)
  deskRoutes(app, ctx)
  adminRoutes(app, ctx)

  if (existsSync(ctx.cfg.webDir)) {
    await app.register(fastifyStatic, {
      root: ctx.cfg.webDir,
      wildcard: false,
      setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      },
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.code(404).send({ error: 'No encontrado' })
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
    })
  }
  return app
}
