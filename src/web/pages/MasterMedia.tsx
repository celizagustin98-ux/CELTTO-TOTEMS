import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ArrowUp, CheckCircle2, CloudUpload, Film, FolderOpen, Globe, ImageIcon, Link2, Loader2, Pencil, Plus, RefreshCw, Trash2, Tv, XCircle } from 'lucide-react'
import { api, type Settings } from '../lib/api'
import { useLoad } from '../lib/live'
import { Button, ErrorBox, Field, Modal, PageHeader, Segmented, SkeletonPage, Toggle, inputCls, useConfirm, useToast } from '../ui'

type Item = { id: number; source: 'url' | 'upload'; kind: 'image' | 'video'; title: string | null; url: string; size: number | null; createdAt: string }
type ShareFile = { name: string; kind: 'image' | 'video'; size: number; modifiedAt: string; url: string }
type MediaState = { items: Item[]; share: { configured: boolean; enabled: boolean; subdir: string; root: string | null; files: ShareFile[]; error: string | null }; uploadEnabled: boolean }
type Check = { ok: boolean; status: number; contentType?: string; kind?: 'image' | 'video' | null; error?: string }
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm'
const mb = (b: number | null) => (b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`)
const kindOf = (url: string): 'image' | 'video' | null => {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(url)
  if (!m) return null
  return ['mp4', 'm4v', 'webm'].includes(m[1].toLowerCase()) ? 'video' : ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(m[1].toLowerCase()) ? 'image' : null
}

function Thumb({ url, kind, className = '' }: { url: string; kind: 'image' | 'video'; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) return <div className={`grid place-items-center bg-paper text-muted ${className}`}><XCircle size={18} /></div>
  return kind === 'video' ? (
    <video src={url} muted preload="metadata" className={`bg-black object-cover ${className}`} onError={() => setBroken(true)} />
  ) : (
    <img src={url} alt="" loading="lazy" className={`bg-paper object-cover ${className}`} onError={() => setBroken(true)} />
  )
}

/** Vista previa en miniatura de cómo rota la publicidad en la TV. */
function TvPreview({ list, interval }: { list: { url: string; kind: 'image' | 'video' }[]; interval: number }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (list.length <= 1) return
    const id = setInterval(() => setI((x) => (x + 1) % list.length), Math.min(interval, 6) * 1000)
    return () => clearInterval(id)
  }, [list.length, interval])
  const it = list[i % Math.max(1, list.length)]
  return (
    <div className="overflow-hidden rounded-2xl border-[6px] border-slate-800 bg-night shadow-xl">
      <div className="flex gap-2 p-2">
        <div className="relative aspect-video flex-[1.85] overflow-hidden rounded-lg bg-black/60">
          <AnimatePresence mode="sync">
            {it ? (
              <motion.div key={it.url + i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} className="absolute inset-0">
                {it.kind === 'video' ? <video src={it.url} muted autoPlay loop playsInline className="h-full w-full object-cover" /> : <img src={it.url} alt="" className="h-full w-full object-cover" />}
              </motion.div>
            ) : (
              <div className="grid h-full place-items-center text-[10px] text-white/40">Sin publicidad</div>
            )}
          </AnimatePresence>
          <span className="absolute left-1.5 top-1.5 rounded bg-black/50 px-1 text-[8px] uppercase tracking-wider text-white/70">Publicidad</span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="rounded-md bg-teal-600 p-1.5 text-white">
            <div className="text-[6px] uppercase tracking-widest opacity-80">Llamando</div>
            <div className="num text-lg leading-none">A-014</div>
            <div className="text-[7px]">Box 1</div>
          </div>
          {['A-013', 'B-007', 'A-012'].map((c) => <div key={c} className="num rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/80">{c}</div>)}
        </div>
      </div>
    </div>
  )
}

export default function MediaPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const st = useLoad(() => api<MediaState>('/api/admin/media'))
  const cfg = useLoad(() => api<Settings>('/api/admin/settings'))
  const [tab, setTab] = useState<'url' | 'share' | 'upload'>('url')
  const [form, setForm] = useState({ url: '', title: '', kind: '' as '' | 'image' | 'video' })
  const [check, setCheck] = useState<Check | null>(null)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [subdir, setSubdir] = useState<string | null>(null)
  const [edit, setEdit] = useState<Item | null>(null)
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const saveSetting = async (patch: Partial<Settings>, ok = 'Guardado') => {
    try {
      cfg.setData(await api<Settings>('/api/admin/settings', { method: 'PUT', body: patch }))
      await st.reload()
      toast(ok)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const test = async () => {
    setChecking(true)
    setCheck(null)
    try {
      const r = await api<Check>('/api/admin/media/check-url', { body: { url: form.url.trim() } })
      setCheck(r)
      if (r.ok && r.kind && !form.kind && !kindOf(form.url)) setForm((f) => ({ ...f, kind: r.kind as 'image' | 'video' }))
    } catch (e) {
      setCheck({ ok: false, status: 0, error: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }
  const addUrl = async () => {
    setBusy(true)
    try {
      await api('/api/admin/media/url', { body: { url: form.url.trim(), title: form.title || null, kind: form.kind || undefined } })
      setForm({ url: '', title: '', kind: '' })
      setCheck(null)
      await st.reload()
      toast('Agregado a la publicidad')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const move = async (id: number, dir: -1 | 1) => {
    const list = [...(st.data?.items ?? [])]
    const i = list.findIndex((x) => x.id === id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    st.setData({ ...st.data!, items: list })
    await api('/api/admin/media/order', { method: 'PUT', body: { ids: list.map((x) => x.id) } })
  }
  const remove = async (m: Item) => {
    if (!(await confirm({ title: 'Quitar de la publicidad', message: m.source === 'url' ? 'Se deja de mostrar en la TV. El archivo sigue en su servidor de origen.' : 'Se borra el archivo subido a este servidor.', confirmLabel: 'Quitar', danger: true }))) return
    await api(`/api/admin/media/${m.id}`, { method: 'DELETE' })
    await st.reload()
    toast('Quitado')
  }
  const upload = async (files: FileList) => {
    try {
      for (const f of Array.from(files)) {
        if (!ACCEPT.split(',').includes(f.type)) { toast(`${f.name}: formato no permitido`, 'error'); continue }
        setUploading({ name: f.name, pct: 0 })
        await new Promise<void>((resolve, reject) => {
          const x = new XMLHttpRequest()
          x.open('POST', `/api/admin/media?name=${encodeURIComponent(f.name)}`)
          x.setRequestHeader('Content-Type', f.type)
          x.upload.onprogress = (e) => e.lengthComputable && setUploading({ name: f.name, pct: Math.round((e.loaded / e.total) * 100) })
          x.onload = () => (x.status < 300 ? resolve() : reject(new Error((() => { try { return JSON.parse(x.responseText).error } catch { return 'No se pudo subir' } })())))
          x.onerror = () => reject(new Error('Sin conexión con el servidor'))
          x.send(f)
        })
      }
      await st.reload()
      toast('Archivos subidos')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setUploading(null)
      if (file.current) file.current.value = ''
    }
  }

  if (st.loading || cfg.loading) return <SkeletonPage />
  if (st.error || cfg.error) return <ErrorBox msg={(st.error ?? cfg.error)!} retry={st.reload} />
  const s = st.data!
  const settings = cfg.data!
  const playlist = [...s.items.map((m) => ({ url: m.url, kind: m.kind })), ...(s.share.enabled ? s.share.files.map((f) => ({ url: f.url, kind: f.kind })) : [])]
  const videos = playlist.filter((p) => p.kind === 'video').length
  const autoKind = kindOf(form.url)
  const mixed = location.protocol === 'https:' && /^http:\/\//i.test(form.url)

  return (
    <div className="space-y-6">
      <PageHeader title="Publicidad" description="Imágenes y videos que rotan en el recuadro de publicidad de la TV. Se cargan por dirección o desde una carpeta compartida de otro servidor: no hace falta guardarlos acá." />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <div className="surface flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <Toggle checked={settings.tv_media_enabled} onChange={(v) => void saveSetting({ tv_media_enabled: v }, v ? 'Publicidad activada' : 'Publicidad desactivada')} label="Mostrar publicidad en la TV" />
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Cada imagen
              <input type="number" min={5} max={300} defaultValue={settings.tv_media_interval_sec} onBlur={(e) => Number(e.target.value) !== settings.tv_media_interval_sec && void saveSetting({ tv_media_interval_sec: Number(e.target.value) })} className={`${inputCls} !w-20 !py-1.5`} aria-label="Segundos por imagen" />
              seg. · los videos se ven completos
            </label>
          </div>

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'url', label: <span className="flex items-center gap-1.5"><Link2 size={14} /> Direcciones</span> },
              { value: 'share', label: <span className="flex items-center gap-1.5"><FolderOpen size={14} /> Carpeta compartida</span> },
              { value: 'upload', label: <span className="flex items-center gap-1.5"><CloudUpload size={14} /> Subir archivos</span> },
            ]}
          />

          <AnimatePresence mode="wait">
            {tab === 'url' && (
              <motion.div key="url" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="surface space-y-4 p-5">
                <div>
                  <h2 className="font-semibold">Agregar por dirección</h2>
                  <p className="text-[13px] text-muted">Pegá la dirección de una imagen o video publicado en otro servidor (por ejemplo, la intranet). La TV lo carga directo desde ahí.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <Field label="Dirección (URL)">
                    <div className="relative">
                      <Globe size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                      <input className={`${inputCls} pl-9`} value={form.url} onChange={(e) => { setForm({ ...form, url: e.target.value }); setCheck(null) }} placeholder="http://servidor/publicidad/aviso.mp4" />
                    </div>
                  </Field>
                  <div className="flex items-end">
                    <Button variant="soft" onClick={test} disabled={checking || !/^https?:\/\/.+/i.test(form.url.trim())}>{checking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Probar</Button>
                  </div>
                </div>
                {check && (
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${check.ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger'}`}>
                    {check.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    {check.ok ? `Responde correctamente${check.contentType ? ` (${check.contentType.split(';')[0]})` : ''}` : check.error ?? `El servidor respondió ${check.status}`}
                  </div>
                )}
                {mixed && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">El panel está en https y la dirección en http: algunas TVs podrían bloquearla. Si pasa, usá https o la carpeta compartida.</p>}
                <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                  <Field label="Nombre (opcional)"><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Campaña de vacunación" /></Field>
                  <Field label="Tipo" hint={autoKind ? `Detectado: ${autoKind === 'video' ? 'video' : 'imagen'}` : 'Elegilo si la dirección no termina en .mp4, .jpg…'}>
                    <select className={inputCls} value={form.kind || autoKind || ''} onChange={(e) => setForm({ ...form, kind: e.target.value as '' | 'image' | 'video' })}>
                      <option value="">Elegir…</option>
                      <option value="image">Imagen</option>
                      <option value="video">Video</option>
                    </select>
                  </Field>
                </div>
                <Button onClick={addUrl} disabled={busy || !/^https?:\/\/.+/i.test(form.url.trim()) || !(form.kind || autoKind)}><Plus size={16} /> Agregar a la publicidad</Button>
              </motion.div>
            )}

            {tab === 'share' && (
              <motion.div key="share" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="surface space-y-4 p-5">
                <div>
                  <h2 className="font-semibold">Carpeta compartida de otro servidor</h2>
                  <p className="text-[13px] text-muted">Se reproduce todo lo que haya en la carpeta, en orden alfabético. Para cambiar la publicidad, copiá o borrá archivos ahí: no se guarda nada en este servidor.</p>
                </div>
                {!s.share.configured ? (
                  <div className="rounded-xl border border-dashed border-line p-4 text-[13.5px] text-muted">
                    <b className="text-ink">Todavía no hay una carpeta compartida montada.</b> El técnico la conecta una sola vez en el servidor
                    (variable <code>MEDIA_SHARE_HOST</code>, guía en <code>deploy/linux/PUBLICIDAD.md</code>) y después aparece acá.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-paper px-4 py-3 text-[13px]">
                      <FolderOpen size={16} className="text-brand" />
                      <code className="flex-1 truncate">{s.share.root}{s.share.subdir ? `/${s.share.subdir}` : ''}</code>
                      <Button size="sm" variant="ghost" onClick={async () => st.setData(await api<MediaState>('/api/admin/media?refresh=1'))}><RefreshCw size={14} /> Actualizar</Button>
                    </div>
                    <Toggle checked={s.share.enabled} onChange={(v) => void saveSetting({ media_share_enabled: v }, v ? 'Carpeta compartida activada' : 'Carpeta compartida desactivada')} label="Reproducir los archivos de la carpeta compartida" />
                    <div className="flex items-end gap-2">
                      <Field label="Subcarpeta (opcional)" hint="Por ejemplo TV-Sala. Vacío = la carpeta principal.">
                        <input className={inputCls} value={subdir ?? s.share.subdir} onChange={(e) => setSubdir(e.target.value)} placeholder="TV-Sala" />
                      </Field>
                      <Button variant="soft" disabled={subdir === null || subdir === s.share.subdir} onClick={async () => { await saveSetting({ media_share_subdir: subdir ?? '' }); setSubdir(null) }}>Guardar</Button>
                    </div>
                    {s.share.error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{s.share.error}</p>}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {s.share.files.map((f) => (
                        <div key={f.name} className="overflow-hidden rounded-xl border border-line">
                          <Thumb url={f.url} kind={f.kind} className="aspect-video w-full" />
                          <div className="flex items-center gap-1.5 px-2.5 py-2 text-[12px]">
                            {f.kind === 'video' ? <Film size={13} className="text-muted" /> : <ImageIcon size={13} className="text-muted" />}
                            <span className="min-w-0 flex-1 truncate" title={f.name}>{f.name}</span>
                            <span className="text-muted">{mb(f.size)}</span>
                          </div>
                        </div>
                      ))}
                      {s.share.files.length === 0 && !s.share.error && <p className="col-span-full text-sm text-muted">La carpeta no tiene imágenes ni videos compatibles.</p>}
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {tab === 'upload' && (
              <motion.div key="upload" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="surface space-y-4 p-5">
                <div>
                  <h2 className="font-semibold">Subir archivos a este servidor (opcional)</h2>
                  <p className="text-[13px] text-muted">Para instalaciones sin otro servidor de archivos. Los archivos ocupan espacio en este servidor y entran en sus respaldos.</p>
                </div>
                <Toggle checked={s.uploadEnabled} onChange={(v) => void saveSetting({ media_upload_enabled: v }, v ? 'Subida habilitada' : 'Subida deshabilitada')} label="Permitir subir archivos desde el panel" />
                {s.uploadEnabled && (
                  <>
                    <input ref={file} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
                    <button
                      type="button"
                      onClick={() => file.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files) }}
                      disabled={!!uploading}
                      className="relative flex w-full flex-col items-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-line px-6 py-10 text-muted transition hover:border-brand hover:bg-brand-soft/30 hover:text-brand"
                    >
                      <CloudUpload size={28} />
                      <span className="font-medium">{uploading ? `Subiendo ${uploading.name}… ${uploading.pct}%` : 'Arrastrá archivos acá o hacé clic'}</span>
                      <span className="text-[12px]">MP4/WEBM hasta 200 MB · PNG/JPG/WEBP/GIF hasta 5 MB</span>
                      {uploading && <span className="absolute inset-x-0 bottom-0 h-1 bg-line"><span className="block h-full bg-brand transition-all" style={{ width: `${uploading.pct}%` }} /></span>}
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="font-semibold">Lista de reproducción</h2>
              <span className="text-[12.5px] text-muted">{s.items.length} cargados{s.share.enabled ? ` + ${s.share.files.length} de la carpeta` : ''}</span>
            </div>
            {s.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Todavía no agregaste publicidad por dirección{s.uploadEnabled ? ' ni subiste archivos' : ''}.</p>
            ) : (
              <ul className="divide-y divide-line">
                {s.items.map((m, i) => (
                  <motion.li key={m.id} layout className="flex items-center gap-3 px-4 py-3">
                    <span className="num w-6 text-center text-muted">{i + 1}</span>
                    <Thumb url={m.url} kind={m.kind} className="h-12 w-20 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.title || (m.source === 'url' ? new URL(m.url, location.origin).pathname.split('/').pop() : 'Archivo subido')}</div>
                      <div className="flex items-center gap-1.5 text-[12px] text-muted">
                        <span className={`badge ${m.kind === 'video' ? 'badge-brand' : 'badge-muted'}`}>{m.kind === 'video' ? 'Video' : 'Imagen'}</span>
                        <span className="badge badge-muted">{m.source === 'url' ? 'Dirección' : `Subido${m.size ? ` · ${mb(m.size)}` : ''}`}</span>
                        {m.source === 'url' && <span className="truncate">{m.url}</span>}
                      </div>
                    </div>
                    <button onClick={() => void move(m.id, -1)} disabled={i === 0} className="rounded-md p-1.5 text-muted hover:bg-paper disabled:opacity-30" aria-label="Subir en la lista"><ArrowUp size={15} /></button>
                    <button onClick={() => void move(m.id, 1)} disabled={i === s.items.length - 1} className="rounded-md p-1.5 text-muted hover:bg-paper disabled:opacity-30" aria-label="Bajar en la lista"><ArrowDown size={15} /></button>
                    <button onClick={() => setEdit(m)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink" aria-label="Editar"><Pencil size={15} /></button>
                    <button onClick={() => void remove(m)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-danger" aria-label="Quitar"><Trash2 size={15} /></button>
                  </motion.li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted"><Tv size={15} /> Así se ve en la TV</div>
            <TvPreview list={settings.tv_media_enabled ? playlist : []} interval={settings.tv_media_interval_sec} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[['Total', playlist.length], ['Videos', videos], ['Imágenes', playlist.length - videos]].map(([l, v]) => (
              <div key={l} className="surface p-3 text-center">
                <div className="num text-2xl">{v}</div>
                <div className="text-[11.5px] text-muted">{l}</div>
              </div>
            ))}
          </div>
          {!settings.tv_media_enabled && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">La publicidad está desactivada: la TV muestra solo los llamados.</p>}
        </aside>
      </div>

      {edit && (
        <Modal
          title="Editar"
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button variant="soft" onClick={() => setEdit(null)}>Cancelar</Button>
              <Button onClick={async () => { await api(`/api/admin/media/${edit.id}`, { method: 'PUT', body: { title: edit.title, kind: edit.kind } }); setEdit(null); await st.reload(); toast('Guardado') }}>Guardar</Button>
            </>
          }
        >
          <Field label="Nombre"><input className={inputCls} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} autoFocus /></Field>
          <Field label="Tipo">
            <select className={inputCls} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as 'image' | 'video' })}>
              <option value="image">Imagen</option>
              <option value="video">Video</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
