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
  const app = Fastify({ logger: ctx.cfg.logger, trustProxy: true })
  await app.register(cookie)
  await app.register(websocket)
  app.decorateRequest('user', null)
  // acepta POST con Content-Type JSON y cuerpo vacío (acciones sin datos)
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try { done(null, body ? JSON.parse(body as string) : {}) } catch (e) { done(Object.assign(e as Error, { statusCode: 400, message: 'JSON inválido' })) }
  })

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message })
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? 'Datos inválidos', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message })
    req.log.error(err)
    return reply.code(500).send({ error: 'Error interno del servidor' })
  })

  app.get('/ws', { websocket: true }, (socket) => { ctx.hub.add(socket); socket.send(JSON.stringify({ type: 'hello' })) })
  publicRoutes(app, ctx)
  deskRoutes(app, ctx)
  adminRoutes(app, ctx)

  if (existsSync(ctx.cfg.webDir)) {
    await app.register(fastifyStatic, { root: ctx.cfg.webDir, wildcard: false })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.code(404).send({ error: 'No encontrado' })
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
    })
  }
  return app
}
