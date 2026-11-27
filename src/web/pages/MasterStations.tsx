import { useState } from 'react'
import { Copy, ExternalLink, Monitor, Pencil, Plus, QrCode, RefreshCw, Trash2, Tv } from 'lucide-react'
import { api, type Sector } from '../lib/api'
import { ago } from '../lib/format'
import { useLive, useLoad, useNow } from '../lib/live'
import { SUPPORTED_LANGS } from '../i18n'
import { Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, QR, Spinner, inputCls, useConfirm, useToast } from '../ui'

type Station = { id: number; kind: 'totem' | 'tv'; name: string; sector_id: number | null; sector_name: string | null; sector_color: string | null; device_key: string; lang: string | null; last_seen_at: string | null }
type Form = { id?: number; kind: 'totem' | 'tv'; name: string; sectorId: number | null; lang: string }

const stationUrl = (kind: 'totem' | 'tv', key: string) => `${location.origin}/${kind}/${encodeURIComponent(key)}`
/** En línea si se comunicó en los últimos 5 minutos (las pantallas consultan cada 1–2 min). */
const online = (iso: string | null, now: number) => !!iso && now - Date.parse(iso) < 5 * 60_000

export default function Stations() {
  const toast = useToast()
  const confirm = useConfirm()
  const now = useNow(30_000)
  const rows = useLoad(() => api<Station[]>('/api/admin/stations'))
  const sectors = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const [f, setF] = useState<Form | null>(null)
  const [qr, setQr] = useState<Station | null>(null)
  const [busy, setBusy] = useState(false)
  useLive((m) => m.type === 'config' && void rows.reload())

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Dirección copiada')
    } catch {
      toast('No se pudo copiar', 'error')
    }
  }
  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      const body = { name: f.name.trim(), sectorId: f.sectorId, lang: f.lang || null }
      if (f.id) await api(`/api/admin/stations/${f.id}`, { method: 'PUT', body })
      else {
        const r = await api<{ id: number; deviceKey: string }>('/api/admin/stations', { body: { ...body, kind: f.kind } })
        setQr({ id: r.id, kind: f.kind, name: body.name, sector_id: f.sectorId, sector_name: null, sector_color: null, device_key: r.deviceKey, lang: f.lang || null, last_seen_at: null })
      }
      toast(f.id ? 'Estación actualizada' : 'Estación creada — abrí la dirección en el equipo')
      setF(null)
      await rows.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const rotate = async (s: Station) => {
    if (!(await confirm({ title: 'Generar dirección nueva', message: <>La dirección actual de <b>{s.name}</b> deja de funcionar. Usalo si se filtró o se cambió el equipo. Después hay que abrir la nueva en el dispositivo.</>, confirmLabel: 'Generar nueva', danger: true }))) return
    try {
      const r = await api<{ deviceKey: string }>(`/api/admin/stations/${s.id}/rotate`, { method: 'POST' })
      await rows.reload()
      setQr({ ...s, device_key: r.deviceKey })
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const remove = async (s: Station) => {
    if (!(await confirm({ title: 'Eliminar estación', message: <>La dirección de <b>{s.name}</b> deja de funcionar.</>, confirmLabel: 'Eliminar', danger: true }))) return
    try {
      await api(`/api/admin/stations/${s.id}`, { method: 'DELETE' })
      toast('Estación eliminada')
      await rows.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (rows.loading) return <Spinner />
  if (rows.error) return <ErrorBox msg={rows.error} retry={rows.reload} />
  const list = rows.data!
  const secs = sectors.data ?? []
  const totems = list.filter((s) => s.kind === 'totem')
  const tvs = list.filter((s) => s.kind === 'tv')

  const Group = ({ title, icon, items }: { title: string; icon: React.ReactNode; items: Station[] }) => (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">{icon}{title} <span className="font-normal">({items.length})</span></h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Todavía no hay ninguno.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => {
            const on = online(s.last_seen_at, now)
            const url = stationUrl(s.kind, s.device_key)
            return (
              <Card key={s.id} className="flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg" style={{ background: `${s.sector_color ?? '#64748b'}22`, color: s.sector_color ?? '#64748b' }}>
                    {s.kind === 'tv' ? <Tv size={20} /> : <Monitor size={20} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{s.name}</div>
                    <div className="truncate text-[13px] text-muted">{s.sector_name ?? (s.kind === 'tv' ? 'Todas las secretarías' : 'Elige secretaría en el equipo')}</div>
                  </div>
                  <span className={`badge ${on ? 'badge-ok' : s.last_seen_at ? 'badge-danger' : 'badge-muted'}`} title={s.last_seen_at ? new Date(s.last_seen_at).toLocaleString('es-AR') : undefined}>
                    <span className={`h-1.5 w-1.5 rounded-full bg-current ${on ? 'pulse-dot' : ''}`} />
                    {on ? 'En línea' : s.last_seen_at ? 'Sin conexión' : 'Sin usar'}
                  </span>
                </div>
                <div className="mt-3 text-[12px] text-muted">
                  Último contacto: {ago(s.last_seen_at, now)}
                  {s.lang && ` · Idioma: ${SUPPORTED_LANGS.find((l) => l.code === s.lang)?.label}`}
                </div>
                <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-3">
                  <Button size="sm" variant="ghost" onClick={() => setQr(s)}><QrCode size={15} /> QR</Button>
                  <Button size="sm" variant="ghost" onClick={() => copy(url)}><Copy size={15} /> Copiar</Button>
                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted hover:bg-paper hover:text-ink"><ExternalLink size={15} /> Abrir</a>
                  <span className="flex-1" />
                  <button aria-label={`Editar ${s.name}`} onClick={() => setF({ id: s.id, kind: s.kind, name: s.name, sectorId: s.sector_id, lang: s.lang ?? '' })} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"><Pencil size={15} /></button>
                  <button aria-label={`Nueva dirección para ${s.name}`} title="Generar dirección nueva" onClick={() => rotate(s)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"><RefreshCw size={15} /></button>
                  <button aria-label={`Eliminar ${s.name}`} onClick={() => remove(s)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-danger"><Trash2 size={15} /></button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )

  return (
    <div className="fade-up space-y-6">
      <PageHeader
        title="Tótems y TVs"
        description="Cada equipo tiene una dirección fija. Abrila en el navegador del equipo (modo kiosk) y queda configurado con su secretaría e idioma. Podés escanear el QR desde el equipo."
        actions={<Button onClick={() => setF({ kind: 'totem', name: '', sectorId: null, lang: '' })}><Plus size={18} />Nueva estación</Button>}
      />
      {list.length === 0 ? (
        <Empty icon={<Monitor size={22} />} title="Todavía no hay estaciones" hint="Creá un tótem o una TV y abrí su dirección en el equipo." action={<Button onClick={() => setF({ kind: 'totem', name: '', sectorId: null, lang: '' })}>Crear la primera</Button>} />
      ) : (
        <>
          <Group title="Tótems" icon={<Monitor size={15} />} items={totems} />
          <Group title="Pantallas de sala (TV)" icon={<Tv size={15} />} items={tvs} />
        </>
      )}

      {f && (
        <Modal title={f.id ? 'Editar estación' : 'Nueva estación'} onClose={() => setF(null)} footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !f.name.trim()}>{f.id ? 'Guardar' : 'Crear y generar dirección'}</Button></>}>
          {!f.id && (
            <Field label="Tipo">
              <div className="grid grid-cols-2 gap-2">
                {(['totem', 'tv'] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })} className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-3 font-medium ${f.kind === k ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-paper'}`}>
                    {k === 'tv' ? <Tv size={18} /> : <Monitor size={18} />}
                    {k === 'tv' ? 'TV / llamador' : 'Tótem'}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'tv' ? 'TV sala de espera' : 'Tótem entrada'} autoFocus /></Field>
          <Field label="Secretaría" hint={f.kind === 'tv' ? 'Si elegís una, la TV muestra solo sus llamados.' : 'Si elegís una, el tótem queda fijo en esa secretaría.'}>
            <select className={inputCls} value={f.sectorId ?? ''} onChange={(e) => setF({ ...f, sectorId: Number(e.target.value) || null })}>
              <option value="">{f.kind === 'tv' ? 'Todas' : 'Se elige en el equipo'}</option>
              {secs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Idioma de la pantalla" hint="En el tótem, el paciente lo puede cambiar; vuelve a este al terminar.">
            <select className={inputCls} value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>
              <option value="">Español (predeterminado)</option>
              {SUPPORTED_LANGS.filter((l) => l.code !== 'es').map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </Field>
        </Modal>
      )}

      {qr && (
        <Modal title={`Dirección de ${qr.name}`} onClose={() => setQr(null)}>
          <div className="flex flex-col items-center gap-3 text-center">
            <QR value={stationUrl(qr.kind, qr.device_key)} size={220} className="rounded-xl ring-1 ring-line" />
            <code className="w-full break-all rounded-lg bg-paper px-3 py-2 text-[12.5px]">{stationUrl(qr.kind, qr.device_key)}</code>
            <p className="text-[13px] text-muted">
              Escaneala desde el equipo o copiala en su navegador. Para modo kiosk:
              <br />
              <code className="text-[12px]">chrome --kiosk {qr.kind === 'tv' ? '--autoplay-policy=no-user-gesture-required' : '--kiosk-printing'} {stationUrl(qr.kind, qr.device_key)}</code>
            </p>
            <Button variant="soft" onClick={() => copy(stationUrl(qr.kind, qr.device_key))}><Copy size={15} /> Copiar dirección</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
