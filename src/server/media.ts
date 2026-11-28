import { createReadStream, createWriteStream, existsSync, mkdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Ctx } from './db.js'
import { insertId, nowIso } from './db.js'
import { HttpError } from './errors.js'
import { requirePerm } from './auth.js'
import { audit } from './audit.js'
import { getSettings, saveSettings } from './settings.js'

/**
 * Publicidad de la TV. Tres orígenes:
 *  1. Dirección (URL http/https): la TV la carga directo desde el otro servidor. No se guarda nada acá. (Principal)
 *  2. Carpeta compartida de otro servidor, montada en este (MEDIA_SHARE_DIR): se reproduce todo lo que haya
 *     en la carpeta; los archivos se leen al momento, sin copiarlos.
 *  3. Subida de archivos al servidor (opcional, desactivada por defecto).
 */

/** Tipos permitidos y su firma ("magic bytes") para validar las subidas. */
const TYPES: Record<string, { kind: 'image' | 'video'; ext: string; max: number; sniff: (b: Buffer) => boolean }> = {
  'image/png': { kind: 'image', ext: 'png', max: 5_000_000, sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { kind: 'image', ext: 'jpg', max: 5_000_000, sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { kind: 'image', ext: 'webp', max: 5_000_000, sniff: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  'image/gif': { kind: 'image', ext: 'gif', max: 5_000_000, sniff: (b) => b.subarray(0, 4).toString('ascii') === 'GIF8' },
  'video/mp4': { kind: 'video', ext: 'mp4', max: 200_000_000, sniff: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  'video/webm': { kind: 'video', ext: 'webm', max: 200_000_000, sniff: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
}
export const MEDIA_MIMES = Object.keys(TYPES)
const BY_EXT: Record<string, { kind: 'image' | 'video'; mime: string }> = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
}
const MAX_ITEMS = 60

/** Deduce si una dirección es video o imagen por la extensión (si no se puede, la indica el usuario). */
export const kindFromUrl = (url: string): 'image' | 'video' | null => {
  try {
    return BY_EXT[extname(new URL(url).pathname).toLowerCase()]?.kind ?? null
  } catch {
    return null
  }
}

const fileOf = (ctx: Ctx, key: string, ext: string) => join(ctx.cfg.mediaDir, `${key}.${ext}`)
const extOf = (mime: string) => TYPES[mime]?.ext ?? 'bin'

/** Envía un archivo con soporte de rangos (los videos se pueden adelantar y empiezan a reproducirse enseguida). */
function sendFile(req: FastifyRequest, reply: FastifyReply, path: string, mime: string, cache: string) {
  const total = statSync(path).size
  reply.header('Content-Type', mime)
  reply.header('Accept-Ranges', 'bytes')
  reply.header('Cache-Control', cache)
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
}

// ---------- Carpeta compartida ----------

/** Carpeta efectiva (raíz + subcarpeta configurada), validada para que no se pueda salir de la raíz. */
function shareDir(ctx: Ctx, subdir: string) {
  const root = ctx.cfg.mediaShareDir
  if (!root) return null
  const base = resolve(root)
  const dir = resolve(base, subdir || '.')
  if (dir !== base && !dir.startsWith(base + sep)) return null
  return { base, dir }
}

let shareCache: { at: number; key: string; files: ShareFile[]; error: string | null } | null = null
export type ShareFile = { name: string; kind: 'image' | 'video'; size: number; modifiedAt: string; url: string }

/** Lista los archivos de la carpeta compartida (caché de 30 s para no recorrer la red en cada pedido). */
export async function listShare(ctx: Ctx, force = false): Promise<{ configured: boolean; files: ShareFile[]; error: string | null }> {
  const s = await getSettings(ctx)
  const d = shareDir(ctx, s.media_share_subdir)
  if (!d) return { configured: !!ctx.cfg.mediaShareDir, files: [], error: ctx.cfg.mediaShareDir ? 'Subcarpeta inválida' : null }
  const key = d.dir
  if (!force && shareCache && shareCache.key === key && Date.now() - shareCache.at < 30_000) return { configured: true, files: shareCache.files, error: shareCache.error }
  try {
    const names = await readdir(d.dir)
    const files: ShareFile[] = []
    for (const name of names.sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
      const t = BY_EXT[extname(name).toLowerCase()]
      if (!t || name.startsWith('.')) continue
      const st = await stat(join(d.dir, name)).catch(() => null)
      if (!st?.isFile()) continue
      files.push({ name, kind: t.kind, size: st.size, modifiedAt: st.mtime.toISOString(), url: `/api/public/share/${encodeURIComponent(name)}?v=${Math.round(st.mtimeMs)}` })
    }
    shareCache = { at: Date.now(), key, files: files.slice(0, 200), error: null }
  } catch (e) {
    shareCache = { at: Date.now(), key, files: [], error: `No se pudo leer la carpeta: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}` }
  }
  return { configured: true, files: shareCache.files, error: shareCache.error }
}

// ---------- Lista para la TV y el panel ----------

export async function listMedia(ctx: Ctx) {
  const rows = await ctx.db.selectFrom('media').selectAll().where('active', '=', 1).orderBy('sort_order').orderBy('id').execute()
  return rows.map((m) => ({
    id: m.id,
    source: m.source as 'url' | 'upload',
    kind: m.kind as 'image' | 'video',
    title: m.title ?? m.original_name,
    url: m.source === 'url' ? m.url! : `/api/public/media/${m.file_key}`,
    size: m.size_bytes || null,
    createdAt: m.created_at,
  }))
}

/** Lo que reproduce la TV: direcciones y archivos subidos (en su orden) + los de la carpeta compartida. */
export async function tvPlaylist(ctx: Ctx) {
  const s = await getSettings(ctx)
  if (!s.tv_media_enabled) return []
  const items = (await listMedia(ctx)).map((m) => ({ url: m.url, kind: m.kind }))
  if (s.media_share_enabled) items.push(...(await listShare(ctx)).files.map((f) => ({ url: f.url, kind: f.kind })))
  return items.slice(0, 120)
}

/** Pasa las imágenes que antes se guardaban dentro de la base (tabla assets) a archivos en disco. */
export async function migrateLegacyMedia(ctx: Ctx) {
  const rows = await ctx.db.selectFrom('assets').selectAll().where('asset_key', 'like', 'media:%').execute()
  let moved = 0
  if (rows.length) {
    mkdirSync(ctx.cfg.mediaDir, { recursive: true })
    for (const a of rows) {
      const key = a.asset_key.slice(6)
      const buf = Buffer.from(a.data, 'base64')
      writeFileSync(fileOf(ctx, key, extOf(a.mime)), buf)
      await insertId(ctx, ctx.db, 'media', { file_key: key, kind: 'image', mime: a.mime, size_bytes: buf.length, original_name: null, sort_order: 0, active: 1, created_at: a.updated_at, source: 'upload', url: null, title: null })
      await ctx.db.deleteFrom('assets').where('asset_key', '=', a.asset_key).execute()
      moved++
    }
  }
  // Las direcciones que antes se cargaban en un cuadro de texto pasan a ser elementos de la lista
  const s = await getSettings(ctx)
  if (s.tv_media_urls?.trim()) {
    for (const url of s.tv_media_urls.split(/[\n,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u))) {
      await insertId(ctx, ctx.db, 'media', {
        file_key: randomBytes(10).toString('hex'), kind: kindFromUrl(url) ?? 'image', mime: '', size_bytes: 0, original_name: null,
        sort_order: 0, active: 1, created_at: nowIso(), source: 'url', url, title: null,
      })
      moved++
    }
    await saveSettings(ctx, { tv_media_urls: '' })
  }
  return moved
}

const urlBody = z.object({
  url: z.string().trim().max(1000).url('Dirección inválida').refine((u) => /^https?:\/\//i.test(u), 'La dirección debe empezar con http:// o https://'),
  title: z.string().trim().max(120).nullish(),
  kind: z.enum(['image', 'video']).optional(),
})

export function mediaRoutes(app: FastifyInstance, ctx: Ctx) {
  // El cuerpo de imágenes y videos llega como stream (no se carga entero en memoria)
  app.addContentTypeParser(MEDIA_MIMES, (_req, payload, done) => done(null, payload))
  const manage = { preHandler: requirePerm(ctx, 'media.manage') }
  const nextOrder = async () => Number((await ctx.db.selectFrom('media').select((eb) => eb.fn.max('sort_order').as('m')).executeTakeFirst())?.m ?? 0) + 1
  const countItems = async () => Number((await ctx.db.selectFrom('media').select((eb) => eb.fn.countAll<number>().as('n')).where('active', '=', 1).executeTakeFirstOrThrow()).n)

  app.get('/api/admin/media', manage, async (req) => {
    const s = await getSettings(ctx)
    const share = await listShare(ctx, (req.query as any)?.refresh === '1')
    return {
      items: await listMedia(ctx),
      share: { ...share, enabled: s.media_share_enabled, subdir: s.media_share_subdir, root: ctx.cfg.mediaShareDir ?? null },
      uploadEnabled: s.media_upload_enabled,
    }
  })

  /** Agregar por dirección: no se descarga ni se guarda nada en este servidor. */
  app.post('/api/admin/media/url', manage, async (req) => {
    const b = urlBody.parse(req.body)
    if ((await countItems()) >= MAX_ITEMS) throw new HttpError(400, `Máximo ${MAX_ITEMS} elementos`)
    const kind = b.kind ?? kindFromUrl(b.url)
    if (!kind) throw new HttpError(400, 'No se reconoce si es imagen o video por la dirección: indicalo')
    const id = await insertId(ctx, ctx.db, 'media', {
      file_key: randomBytes(10).toString('hex'), kind, mime: '', size_bytes: 0, original_name: null, sort_order: await nextOrder(),
      active: 1, created_at: nowIso(), source: 'url', url: b.url, title: b.title || null,
    })
    await audit(ctx, { userId: req.user!.id, action: 'media.add_url', entity: 'media', entityId: id, detail: { url: b.url.slice(0, 200) }, ip: req.ip })
    ctx.hub.broadcast({ type: 'config' })
    return { id }
  })

  /** Verifica que la dirección responda (ayuda a detectar enlaces rotos antes de mostrarlos en la TV). */
  app.post('/api/admin/media/check-url', manage, async (req) => {
    const { url } = urlBody.pick({ url: true }).parse(req.body)
    try {
      const ctrl = AbortSignal.timeout(6000)
      let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl })
      if (r.status === 405 || r.status === 501) r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(6000) })
      const type = r.headers.get('content-type') ?? ''
      return { ok: r.ok, status: r.status, contentType: type, kind: type.startsWith('video/') ? 'video' : type.startsWith('image/') ? 'image' : kindFromUrl(url) }
    } catch (e) {
      return { ok: false, status: 0, error: (e as Error).name === 'TimeoutError' ? 'El servidor no respondió a tiempo' : 'No se pudo conectar con esa dirección' }
    }
  })

  /** Subida al servidor (opcional: hay que habilitarla en Configuración). */
  app.post('/api/admin/media', manage, async (req) => {
    if (!(await getSettings(ctx)).media_upload_enabled) throw new HttpError(403, 'La subida de archivos está desactivada. Usá una dirección o la carpeta compartida.')
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const t = TYPES[mime]
    if (!t) throw new HttpError(415, 'Formato no permitido. Usá PNG, JPG, WEBP, GIF, MP4 o WEBM.')
    if ((await countItems()) >= MAX_ITEMS) throw new HttpError(400, `Máximo ${MAX_ITEMS} elementos`)
    const name = z.string().max(200).optional().parse((req.query as any).name)?.replace(/[^\p{L}\p{N} ._-]/gu, '') || null
    mkdirSync(ctx.cfg.mediaDir, { recursive: true })
    const key = randomBytes(10).toString('hex')
    const path = fileOf(ctx, key, t.ext)
    const stream = req.body as Readable
    let size = 0
    let head = Buffer.alloc(0)
    const out = createWriteStream(path, { flags: 'wx' })
    try {
      await new Promise<void>((done, fail) => {
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16)
          if (size > t.max) {
            stream.destroy()
            fail(new HttpError(413, `El archivo supera ${Math.round(t.max / 1_000_000)} MB`))
            return
          }
          if (!out.write(chunk)) stream.pause()
        })
        out.on('drain', () => stream.resume())
        stream.on('end', () => out.end(done))
        stream.on('error', fail)
        out.on('error', fail)
      })
      if (!size || !t.sniff(head)) throw new HttpError(400, 'El archivo no corresponde al formato indicado')
    } catch (e) {
      out.destroy()
      try { unlinkSync(path) } catch { /* ya no existe */ }
      throw e
    }
    const id = await insertId(ctx, ctx.db, 'media', { file_key: key, kind: t.kind, mime, size_bytes: size, original_name: name, sort_order: await nextOrder(), active: 1, created_at: nowIso(), source: 'upload', url: null, title: name })
    await audit(ctx, { userId: req.user!.id, action: 'media.upload', entity: 'media', entityId: id, detail: { mime, size }, ip: req.ip })
    ctx.hub.broadcast({ type: 'config' })
    return { id, url: `/api/public/media/${key}`, kind: t.kind }
  })

  app.put('/api/admin/media/order', manage, async (req) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).max(MAX_ITEMS) }).parse(req.body)
    for (const [i, id] of ids.entries()) await ctx.db.updateTable('media').set({ sort_order: i + 1 }).where('id', '=', id).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.put('/api/admin/media/:id', manage, async (req) => {
    const id = z.coerce.number().int().positive().parse((req.params as any).id)
    const b = z.object({ title: z.string().trim().max(120).nullish(), kind: z.enum(['image', 'video']).optional() }).parse(req.body)
    const set: Record<string, unknown> = {}
    if (b.title !== undefined) set.title = b.title || null
    if (b.kind) set.kind = b.kind
    if (Object.keys(set).length) await ctx.db.updateTable('media').set(set).where('id', '=', id).execute()
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  app.delete('/api/admin/media/:id', manage, async (req) => {
    const id = z.coerce.number().int().positive().parse((req.params as any).id)
    const m = await ctx.db.selectFrom('media').selectAll().where('id', '=', id).executeTakeFirst()
    if (!m) throw new HttpError(404, 'No encontrado')
    await ctx.db.deleteFrom('media').where('id', '=', id).execute()
    if (m.source === 'upload') try { unlinkSync(fileOf(ctx, m.file_key, extOf(m.mime))) } catch { /* ya no existe */ }
    await audit(ctx, { userId: req.user!.id, action: 'media.delete', entity: 'media', entityId: id, ip: req.ip })
    ctx.hub.broadcast({ type: 'config' })
    return { ok: true }
  })

  /** Archivo subido al servidor. */
  app.get('/api/public/media/:key', async (req, reply) => {
    const key = z.string().regex(/^[a-z0-9]{6,40}$/).parse((req.params as any).key)
    const m = await ctx.db.selectFrom('media').select(['file_key', 'mime']).where('file_key', '=', key).where('source', '=', 'upload').where('active', '=', 1).executeTakeFirst()
    const path = m && fileOf(ctx, m.file_key, extOf(m.mime))
    if (!m || !path || !existsSync(path)) throw new HttpError(404, 'No encontrado')
    return sendFile(req, reply, path, m.mime, 'public, max-age=86400, immutable')
  })

  /** Archivo de la carpeta compartida (se lee al momento; nunca se copia a este servidor). */
  app.get('/api/public/share/:name', async (req, reply) => {
    const raw = z.string().min(1).max(255).parse((req.params as any).name)
    const name = basename(raw)
    const t = BY_EXT[extname(name).toLowerCase()]
    if (name !== raw || !t || name.startsWith('.')) throw new HttpError(404, 'No encontrado')
    const s = await getSettings(ctx)
    const d = shareDir(ctx, s.media_share_subdir)
    if (!d || !s.media_share_enabled) throw new HttpError(404, 'No encontrado')
    const path = join(d.dir, name)
    let real: string
    try {
      real = realpathSync(path)
    } catch {
      throw new HttpError(404, 'No encontrado')
    }
    // Aunque haya accesos directos (symlinks), nunca se sirve algo fuera de la carpeta compartida
    if (real !== d.base && !real.startsWith(realpathSync(d.base) + sep)) throw new HttpError(404, 'No encontrado')
    return sendFile(req, reply, real, t.mime, 'public, max-age=300')
  })
}
