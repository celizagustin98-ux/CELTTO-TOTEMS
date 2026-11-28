import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Ctx } from './db.js'
import { insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { requirePerm } from './auth.js'
import { audit } from './audit.js'

/** Tipos permitidos y su firma ("magic bytes"): se valida el contenido real, no solo la extensión. */
const TYPES: Record<string, { kind: 'image' | 'video'; ext: string; max: number; sniff: (b: Buffer) => boolean }> = {
  'image/png': { kind: 'image', ext: 'png', max: 5_000_000, sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { kind: 'image', ext: 'jpg', max: 5_000_000, sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { kind: 'image', ext: 'webp', max: 5_000_000, sniff: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  'image/gif': { kind: 'image', ext: 'gif', max: 5_000_000, sniff: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  'video/mp4': { kind: 'video', ext: 'mp4', max: 200_000_000, sniff: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  'video/webm': { kind: 'video', ext: 'webm', max: 200_000_000, sniff: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
}
export const MEDIA_MIMES = Object.keys(TYPES)
const MAX_ITEMS = 40

const fileOf = (ctx: Ctx, key: string, ext: string) => join(ctx.cfg.mediaDir, `${key}.${ext}`)
const extOf = (mime: string) => TYPES[mime]?.ext ?? 'bin'

export async function listMedia(ctx: Ctx) {
  const rows = await ctx.db.selectFrom('media').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('id').execute()
  return rows.map((m) => ({ id: m.id, key: m.file_key, kind: m.kind, mime: m.mime, size: m.size_bytes, name: m.original_name, url: `/api/public/media/${m.file_key}`, createdAt: m.created_at }))
}

/** Pasa las imágenes que antes se guardaban dentro de la base (tabla assets) a archivos en disco. */
export async function migrateLegacyMedia(ctx: Ctx) {
  const rows = await ctx.db.selectFrom('assets').selectAll().where('asset_key', 'like', 'media:%').execute()
  if (!rows.length) return 0
  mkdirSync(ctx.cfg.mediaDir, { recursive: true })
  for (const a of rows) {
    const key = a.asset_key.slice(6)
    const buf = Buffer.from(a.data, 'base64')
    writeFileSync(fileOf(ctx, key, extOf(a.mime)), buf)
    await insertId(ctx, ctx.db, 'media', { file_key: key, kind: 'image', mime: a.mime, size_bytes: buf.length, original_name: null, sort_order: 0, active: 1, created_at: a.updated_at })
    await ctx.db.deleteFrom('assets').where('asset_key', '=', a.asset_key).execute()
  }
  return rows.length
}

export function mediaRoutes(app: FastifyInstance, ctx: Ctx) {
  // El cuerpo de imágenes y videos llega como stream (no se carga entero en memoria)
  app.addContentTypeParser(MEDIA_MIMES, (_req, payload, done) => done(null, payload))
  const manage = { preHandler: requirePerm(ctx, 'media.manage') }

  app.get('/api/admin/media', manage, async () => listMedia(ctx))

  app.post('/api/admin/media', manage, async (req) => {
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const t = TYPES[mime]
    if (!t) throw new HttpError(415, 'Formato no permitido. Usá PNG, JPG, WEBP, GIF, MP4 o WEBM.')
    const count = Number((await ctx.db.selectFrom('media').select((eb) => eb.fn.countAll<number>().as('n')).where('active', '=', 1).executeTakeFirstOrThrow()).n)
    if (count >= MAX_ITEMS) throw new HttpError(400, `Máximo ${MAX_ITEMS} archivos. Eliminá alguno para subir otro.`)
    const name = z.string().max(200).optional().parse((req.query as any).name)?.replace(/[^\p{L}\p{N} ._-]/gu, '') || null
    mkdirSync(ctx.cfg.mediaDir, { recursive: true })
    const key = randomBytes(10).toString('hex')
    const path = fileOf(ctx, key, t.ext)
    const stream = req.body as Readable
    let size = 0
    let head = Buffer.alloc(0)
    const out = createWriteStream(path, { flags: 'wx' })
    try {
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16)
          if (size > t.max) {
            stream.destroy()
            reject(new HttpError(413, `El archivo supera ${Math.round(t.max / 1_000_000)} MB`))
            return
          }
          if (!out.write(chunk)) stream.pause()
        })
        out.on('drain', () => stream.resume())
        stream.on('end', () => out.end(resolve))
        stream.on('error', reject)
        out.on('error', reject)
      })
      if (!size || !t.sniff(head)) throw new HttpError(400, 'El archivo no corresponde al formato indicado')
    } catch (e) {
      out.destroy()
      try { unlinkSync(path) } catch { /* ya no existe */ }
      throw e
    }
    const max = await ctx.db.selectFrom('media').select((eb) => eb.fn.max('sort_order').as('m')).executeTakeFirst()
    const id = await insertId(ctx, ctx.db, 'media', { file_key: key, kind: t.kind, mime, size_bytes: size, original_name: name, sort_order: Number(max?.m ?? 0) + 1, active: 1, created_at: nowIso() })
    await audit(ctx, { userId: req.user!.id, action: 'media.upload', entity: 'media', entityId: id, detail: { mime, size }, ip: req.ip })
    ctx.hub.broadcast({ type: 'config' })
    return { id, key, url: `/api/public/media/${key}`, kind: t.kind }
  })

  app.put('/api/admin/media/order', manage, async (req) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(MAX_ITEMS) }).parse(req.body)
    for (const [i, id] of ids.entries()) await ctx.db.updateTable('media').set({ sort_order: i + 1 }).where('id', '=', id).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.delete('/api/admin/media/:id', manage, async (req) => {
    const id = z.coerce.number().int().positive().parse((req.params as any).id)
    const m = await ctx.db.selectFrom('media').selectAll().where('id', '=', id).executeTakeFirst()
    if (!m) throw new HttpError(404, 'No encontrado')
    await ctx.db.deleteFrom('media').where('id', '=', id).execute()
    try { unlinkSync(fileOf(ctx, m.file_key, extOf(m.mime))) } catch { /* ya no existe */ }
    await audit(ctx, { userId: req.user!.id, action: 'media.delete', entity: 'media', entityId: id, ip: req.ip })
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  /** Sirve el archivo con soporte de rangos (los videos se pueden adelantar y empiezan a reproducirse enseguida). */
  app.get('/api/public/media/:key', async (req, reply) => {
    const key = z.string().regex(/^[a-z0-9]{6,40}$/).parse((req.params as any).key)
    const m = await ctx.db.selectFrom('media').select(['file_key', 'mime']).where('file_key', '=', key).where('active', '=', 1).executeTakeFirst()
    const path = m && fileOf(ctx, m.file_key, extOf(m.mime))
    if (!m || !path || !existsSync(path)) throw new HttpError(404, 'No encontrado')
    const total = statSync(path).size
    reply.header('Content-Type', m.mime)
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Cache-Control', 'public, max-age=86400, immutable')
    reply.header('Content-Security-Policy', "default-src 'none'")
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1
      if (start >= total || start > end) return reply.code(416).header('Content-Range', `bytes */${total}`).send()
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${total}`).header('Content-Length', end - start + 1)
      return reply.send(createReadStream(path, { start, end }))
    }
    reply.header('Content-Length', total)
    return reply.send(createReadStream(path))
  })
}
