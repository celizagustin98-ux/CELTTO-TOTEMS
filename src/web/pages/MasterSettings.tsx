import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, ImagePlus, ImageUp, Trash2, Volume2 } from 'lucide-react'
import { api, type Settings } from '../lib/api'
import { useLoad } from '../lib/live'
import { Announcer, fillTemplate } from '../lib/sound'
import { Logo } from '../components/Brand'
import { Button, Card, ColorPicker, ErrorBox, Field, PageHeader, Segmented, Spinner, Toggle, inputCls, useConfirm, useToast } from '../ui'

interface Sys { db: string; dbLatencyMs: number; server: string; database: string; timezone: string; wsClients: number; hub: string; node: string; uptimeSec: number; version: string }
const TOKENS = ['{prefix}', '{number}', '{code}', '{sector}', '{desk}', '{place}']
const DB_LABEL: Record<string, string> = { postgres: 'PostgreSQL', mssql: 'SQL Server', sqlite: 'SQLite (solo pruebas)' }
const LAYOUTS: { v: Settings['tv_layout']; t: string; d: string }[] = [
  { v: 'split', t: 'Llamado + historial', d: 'Llamado grande a la izquierda; historial, colas y multimedia al costado.' },
  { v: 'media', t: 'Multimedia a pantalla completa', d: 'Videos/imágenes ocupan la pantalla; el llamado aparece encima unos segundos.' },
  { v: 'calls', t: 'Solo llamados', d: 'Sin multimedia. Ideal para salas grandes.' },
]

const readDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(f)
  })

type MediaItem = { id: number; key: string; url: string; kind: 'image' | 'video'; mime: string; size: number; name: string | null }
const MEDIA_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm'
const ROLE_OPTS: { v: Settings['mfa_required_roles'][number]; l: string }[] = [
  { v: 'owner', l: 'Control maestro' }, { v: 'admin', l: 'Administradores' }, { v: 'supervisor', l: 'Supervisores' },
  { v: 'tech', l: 'Técnicos' }, { v: 'auditor', l: 'Auditores' }, { v: 'secretary', l: 'Secretarias' },
]

/** Sube un archivo crudo (sin base64) mostrando el progreso: los videos pueden pesar cientos de MB. */
function uploadRaw(file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', `/api/admin/media?name=${encodeURIComponent(file.name)}`)
    x.setRequestHeader('Content-Type', file.type)
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve()
      try { reject(new Error(JSON.parse(x.responseText).error)) } catch { reject(new Error('No se pudo subir el archivo')) }
    }
    x.onerror = () => reject(new Error('Sin conexión con el servidor'))
    x.send(file)
  })
}

function Section({ title, hint, children, id }: { title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <Card className="scroll-mt-6 p-5 sm:p-6">
      <h2 id={id} className="display text-xl font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  )
}

export default function SettingsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { data, error, loading } = useLoad(() => api<Settings>('/api/admin/settings'))
  const sys = useLoad(() => api<Sys>('/api/admin/system'))
  const brand = useLoad(() => api<{ logoVersion: string | null }>('/api/public/sectors'))
  const media = useLoad(() => api<MediaItem[]>('/api/admin/media'))
  const mediaFile = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null)
  const [s, setS] = useState<Settings | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '' })
  const ann = useRef<Announcer | null>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (data) {
      setS(data)
      setSaved(JSON.stringify(data))
    }
  }, [data])
  const dirty = !!s && JSON.stringify(s) !== saved
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (loading || !s) return error ? <ErrorBox msg={error} /> : <Spinner />
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })
  const save = async () => {
    setBusy(true)
    try {
      const r = await api<Settings>('/api/admin/settings', { method: 'PUT', body: s })
      setS(r)
      setSaved(JSON.stringify(r))
      toast('Configuración guardada')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const test = async () => {
    ann.current ??= new Announcer()
    await ann.current.unlock()
    if (!s.tv_chime_enabled && !s.tv_voice_enabled) return toast('El sonido y la voz están desactivados', 'error')
    ann.current.announce({ text: fillTemplate(s.tv_voice_template, { code: 'A-014', prefix: 'A', number: 14, sectorName: 'Secretaría A', desk: 'Box 1' }), rate: s.tv_voice_rate, volume: s.tv_chime_volume, chime: s.tv_chime_enabled, voice: s.tv_voice_enabled })
  }
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Dirección copiada'))
  const changePw = async () => {
    try {
      await api('/api/auth/password', { method: 'PUT', body: pw })
      setPw({ current: '', next: '' })
      toast('Contraseña actualizada. Se cerraron tus otras sesiones.')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const uploadLogo = async (f: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast('El logo tiene que ser PNG, JPG o WEBP', 'error')
    if (f.size > 500_000) return toast('El logo no puede superar los 500 KB', 'error')
    const dataUrl = await readDataUrl(f)
    try {
      await api('/api/admin/logo', { method: 'PUT', body: { dataUrl } })
      await brand.reload()
      toast('Logo actualizado')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const uploadMedia = async (files: FileList) => {
    try {
      for (const f of Array.from(files)) {
        if (!MEDIA_ACCEPT.split(',').includes(f.type)) { toast(`${f.name}: formato no permitido (PNG, JPG, WEBP, GIF, MP4 o WEBM)`, 'error'); continue }
        const max = f.type.startsWith('video/') ? 200_000_000 : 5_000_000
        if (f.size > max) { toast(`${f.name}: supera ${max / 1_000_000} MB`, 'error'); continue }
        setUploading({ name: f.name, pct: 0 })
        await uploadRaw(f, (pct) => setUploading({ name: f.name, pct }))
      }
      await media.reload()
      if (!s?.tv_media_enabled) set('tv_media_enabled', true)
      toast('Publicidad actualizada')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setUploading(null)
      if (mediaFile.current) mediaFile.current.value = ''
    }
  }
  const removeMedia = async (m: MediaItem) => {
    if (!(await confirm({ title: 'Eliminar de la publicidad', message: `Se deja de mostrar ${m.kind === 'video' ? 'el video' : 'la imagen'} en la TV.`, confirmLabel: 'Eliminar', danger: true }))) return
    await api(`/api/admin/media/${m.id}`, { method: 'DELETE' })
    await media.reload()
    toast('Eliminado')
  }
  const moveMedia = async (m: MediaItem, dir: -1 | 1) => {
    const list = [...(media.data ?? [])]
    const i = list.findIndex((x) => x.id === m.id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    media.setData(list)
    await api('/api/admin/media/order', { method: 'PUT', body: { ids: list.map((x) => x.id) } })
  }
  const removeLogo = async () => {
    if (!(await confirm({ title: 'Quitar logo', message: 'Se vuelve a mostrar el isotipo de CELTTO.', confirmLabel: 'Quitar', danger: true }))) return
    await api('/api/admin/logo', { method: 'DELETE' })
    await brand.reload()
    toast('Logo quitado')
  }

  return (
    <div className="space-y-6 pb-24">
      <PageHeader title="Configuración" description="Lo que cambies acá se aplica en el tótem y en la pantalla de sala al guardar, sin reiniciar nada." />

      <Section title="Identidad" hint="Nombre, logo y color que ven los pacientes.">
        <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            <div className="grid h-24 w-24 place-items-center rounded-2xl border border-line bg-paper p-2">
              <Logo key={brand.data?.logoVersion ?? 'none'} version={brand.data?.logoVersion ?? null} className="h-full w-full" />
            </div>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0])} />
            <div className="flex gap-1">
              <Button size="sm" variant="soft" onClick={() => file.current?.click()}><ImageUp size={15} /> Subir</Button>
              {brand.data?.logoVersion && <Button size="sm" variant="ghost" onClick={removeLogo} aria-label="Quitar logo"><Trash2 size={15} /></Button>}
            </div>
            <span className="text-[11px] text-muted">PNG/JPG/WEBP · máx. 500 KB</span>
          </div>
          <div className="space-y-4">
            <Field label="Nombre de la institución" hint="Aparece en el tótem, la TV y el ticket."><input className={inputCls} value={s.org_name} onChange={(e) => set('org_name', e.target.value)} /></Field>
            <Field label="Color principal" hint="Se usa en el fondo del tótem, la TV y la barra de mensajes."><ColorPicker value={s.brand_color} onChange={(v) => set('brand_color', v)} /></Field>
          </div>
        </div>
      </Section>

      <Section title="Pantalla de sala (TV)">
        <Field label="Diseño">
          <div className="grid gap-2 sm:grid-cols-3">
            {LAYOUTS.map((l) => (
              <button key={l.v} type="button" aria-pressed={s.tv_layout === l.v} onClick={() => set('tv_layout', l.v)} className={`rounded-xl border p-3 text-left transition ${s.tv_layout === l.v ? 'border-brand bg-brand-soft/60 ring-1 ring-brand' : 'border-line hover:bg-paper'}`}>
                <LayoutThumb v={l.v} />
                <div className="mt-2 text-sm font-semibold">{l.t}</div>
                <div className="text-xs text-muted">{l.d}</div>
              </button>
            ))}
          </div>
        </Field>
        <Toggle checked={s.tv_chime_enabled} onChange={(v) => set('tv_chime_enabled', v)} label="Sonido al llamar" hint="Suena una campanilla cada vez que se llama o se vuelve a llamar un turno." />
        <Toggle checked={s.tv_voice_enabled} onChange={(v) => set('tv_voice_enabled', v)} label="Voz al llamar" hint="La TV dice el turno en voz alta. Si llaman dos seguidos, los anuncia uno después del otro." />
        <Field label="Frase que dice la voz" hint="Podés usar: {prefix} letra, {number} número, {code} turno completo, {sector}, {desk} puesto, {place} secretaría y puesto.">
          <input className={inputCls} value={s.tv_voice_template} onChange={(e) => set('tv_voice_template', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {TOKENS.map((t) => (
            <button key={t} type="button" onClick={() => set('tv_voice_template', `${s.tv_voice_template} ${t}`.trim())} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-xs hover:bg-line/60">{t}</button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Velocidad de la voz (${s.tv_voice_rate.toFixed(2)})`}><input type="range" min={0.6} max={1.3} step={0.05} value={s.tv_voice_rate} onChange={(e) => set('tv_voice_rate', Number(e.target.value))} className="w-full accent-[var(--color-brand)]" /></Field>
          <Field label={`Volumen del sonido (${Math.round(s.tv_chime_volume * 100)}%)`}><input type="range" min={0.1} max={1} step={0.05} value={s.tv_chime_volume} onChange={(e) => set('tv_chime_volume', Number(e.target.value))} className="w-full accent-[var(--color-brand)]" /></Field>
          <Field label="Llamados en el historial"><input type="number" min={1} max={12} className={inputCls} value={s.tv_history_size} onChange={(e) => set('tv_history_size', Number(e.target.value))} /></Field>
        </div>
        <Button variant="soft" onClick={test}><Volume2 size={17} />Probar sonido y voz</Button>
        <Field label="Mensaje que corre al pie de la TV" hint="Opcional. Avisos generales, horarios, etc. Dejalo vacío para ocultar la barra.">
          <input className={inputCls} value={s.tv_ticker} onChange={(e) => set('tv_ticker', e.target.value)} placeholder="Recordá traer tu documento y la orden médica." maxLength={400} />
        </Field>
      </Section>

      <Section title="Publicidad en la TV" hint="Imágenes y videos MP4 que rotan en el recuadro de publicidad del llamador. Cuando llaman un turno, el llamado aparece encima y queda siempre visible al costado.">
        <Toggle checked={!!s.tv_media_enabled} onChange={(v) => set('tv_media_enabled', v)} label="Mostrar publicidad en la TV" />
        <input ref={mediaFile} type="file" multiple accept={MEDIA_ACCEPT} className="hidden" onChange={(e) => e.target.files?.length && void uploadMedia(e.target.files)} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(media.data ?? []).map((m, i, all) => (
            <div key={m.id} className="group relative aspect-video overflow-hidden rounded-xl border border-line bg-black">
              {m.kind === 'video' ? <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" /> : <img src={m.url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />}
              <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-white">{m.kind === 'video' ? 'Video' : 'Imagen'} · {i + 1}</span>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">{m.name ?? ''}</span>
                <button onClick={() => void moveMedia(m, -1)} disabled={i === 0} className="grid h-7 w-7 place-items-center rounded-md bg-white/15 text-white disabled:opacity-30" aria-label="Mover antes">‹</button>
                <button onClick={() => void moveMedia(m, 1)} disabled={i === all.length - 1} className="grid h-7 w-7 place-items-center rounded-md bg-white/15 text-white disabled:opacity-30" aria-label="Mover después">›</button>
                <button onClick={() => void removeMedia(m)} className="grid h-7 w-7 place-items-center rounded-md bg-red-500/80 text-white" aria-label="Eliminar"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => mediaFile.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void uploadMedia(e.dataTransfer.files) }}
            disabled={!!uploading}
            className="relative flex aspect-video flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed border-line text-muted transition hover:border-brand hover:bg-brand-soft/40 hover:text-brand"
          >
            {uploading ? (
              <>
                <span className="text-[13px] font-medium">Subiendo… {uploading.pct}%</span>
                <span className="max-w-[90%] truncate text-[11px]">{uploading.name}</span>
                <span className="absolute inset-x-0 bottom-0 h-1 bg-line"><span className="block h-full bg-brand transition-all" style={{ width: `${uploading.pct}%` }} /></span>
              </>
            ) : (
              <>
                <ImagePlus size={22} />
                <span className="text-[13px] font-medium">Subir imágenes o videos</span>
                <span className="text-[11px]">MP4/WEBM hasta 200 MB · imágenes hasta 5 MB</span>
              </>
            )}
          </button>
        </div>
        <Field label="Videos o imágenes por dirección (opcional)" hint="Una dirección http/https por línea.">
          <textarea className={inputCls} rows={2} value={s.tv_media_urls || ''} onChange={(e) => set('tv_media_urls', e.target.value)} placeholder="https://ejemplo.com/aviso.mp4" />
        </Field>
        <Field label="Segundos por imagen" hint="Los videos se reproducen completos antes de pasar al siguiente."><input type="number" min={5} max={300} className={`${inputCls} max-w-40`} value={s.tv_media_interval_sec || 20} onChange={(e) => set('tv_media_interval_sec', Number(e.target.value))} /></Field>
      </Section>

      <Section title="Identificación del paciente" hint="Cómo se identifica el paciente en el tótem antes de sacar turno.">
        <Segmented
          value={s.totem_patient_mode}
          onChange={(v) => set('totem_patient_mode', v)}
          options={[
            { value: 'required', label: 'Obligatoria' },
            { value: 'optional', label: 'Opcional' },
            { value: 'off', label: 'Desactivada' },
          ]}
        />
        <p className="text-[13px] text-muted">
          {s.totem_patient_mode === 'required'
            ? 'El paciente ingresa su documento. Si ya está registrado, pasa directo a los botones; si no, completa nombre y apellido una sola vez.'
            : s.totem_patient_mode === 'optional'
              ? 'Se pide el documento, pero el paciente puede continuar sin identificarse.'
              : 'El tótem muestra directamente los botones, sin pedir datos.'}
        </p>
        {s.totem_patient_mode !== 'off' && (
          <Field label="Texto de consentimiento" hint="El paciente nuevo debe aceptarlo antes de registrarse en el tótem.">
            <textarea className={inputCls} rows={2} value={s.consent_text} onChange={(e) => set('consent_text', e.target.value)} maxLength={400} />
          </Field>
        )}
        <Toggle checked={!!s.priorities_enabled} onChange={(v) => set('priorities_enabled', v)} label="Habilitar prioridades" hint="Muestra los botones de atención preferencial/urgente en el tótem y la sección Prioridades. Apagado: todos los turnos se atienden por orden de llegada." />
      </Section>

      <Section title="Tótem y ticket">
        <Toggle checked={s.totem_auto_print} onChange={(v) => set('totem_auto_print', v)} label="Imprimir el ticket automáticamente" hint="Para que salga sin diálogo, abrí Chrome del tótem con --kiosk-printing." />
        <Toggle checked={!!s.totem_idle_enabled} onChange={(v) => set('totem_idle_enabled', v)} label="Pantalla de reposo" hint="Si nadie toca el tótem, muestra el logo y la hora. Al tocar, vuelve a los botones." />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="PIN para cambiar la secretaría" hint="4 a 8 números. Se pide tocando 5 veces la esquina superior izquierda.">
            <input className={inputCls} inputMode="numeric" value={s.totem_pin} onChange={(e) => set('totem_pin', e.target.value.replace(/\D/g, '').slice(0, 8))} />
          </Field>
          <Field label="Segundos que se muestra el ticket"><input type="number" min={3} max={60} className={inputCls} value={s.totem_return_seconds} onChange={(e) => set('totem_return_seconds', Number(e.target.value))} /></Field>
          <Field label="Segundos hasta el reposo"><input type="number" min={15} max={900} className={inputCls} value={s.totem_idle_seconds} onChange={(e) => set('totem_idle_seconds', Number(e.target.value))} disabled={!s.totem_idle_enabled} /></Field>
        </div>
        {s.totem_pin === '0000' && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">El PIN sigue siendo el de fábrica (0000). Cambialo antes de poner el tótem en uso.</p>}
        <Field label="Texto al pie del ticket"><input className={inputCls} value={s.ticket_footer} onChange={(e) => set('ticket_footer', e.target.value)} /></Field>
        <Toggle checked={!!s.qr_ticket_enabled} onChange={(v) => set('qr_ticket_enabled', v)} label="QR en el ticket para seguir el turno desde el celular" hint="Abre un panel privado con los turnos que faltan, el tiempo estimado y el box al que ir." />
        {s.qr_ticket_enabled && (
          <Field label="Texto impreso debajo del QR" hint="Letra chica en el papel. Explica qué puede hacer el paciente con el ticket.">
            <textarea className={inputCls} rows={2} value={s.ticket_qr_hint} onChange={(e) => set('ticket_qr_hint', e.target.value)} maxLength={300} />
          </Field>
        )}
      </Section>

      <Section title="Tiempos de espera y alertas" hint="Colores del semáforo en el panel de la secretaria y alertas del resumen.">
        <Toggle checked={!!s.wait_estimate_enabled} onChange={(v) => set('wait_estimate_enabled', v)} label="Mostrar espera estimada al paciente" hint="Se calcula con el tiempo real de atención de hoy y los puestos que están atendiendo." />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Amarillo desde (min)"><input type="number" min={1} max={600} className={inputCls} value={s.wait_warn_min} onChange={(e) => set('wait_warn_min', Number(e.target.value))} /></Field>
          <Field label="Rojo desde (min)"><input type="number" min={1} max={600} className={inputCls} value={s.wait_danger_min} onChange={(e) => set('wait_danger_min', Number(e.target.value))} /></Field>
          <Field label="Alerta si una cola supera"><input type="number" min={5} max={500} className={inputCls} value={s.alert_queue_waiting || 25} onChange={(e) => set('alert_queue_waiting', Number(e.target.value))} /></Field>
        </div>
      </Section>

      <Section title="Seguridad y datos" hint="Doble factor obligatorio y conservación de la información.">
        <Field label="Exigir doble factor a" hint="Esos usuarios deben configurar el código del celular para poder entrar. Recomendado para control maestro y administradores.">
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTS.map((r) => {
              const on = s.mfa_required_roles.includes(r.v)
              return (
                <button key={r.v} type="button" aria-pressed={on} onClick={() => set('mfa_required_roles', on ? s.mfa_required_roles.filter((x) => x !== r.v) : [...s.mfa_required_roles, r.v])} className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium ${on ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-paper'}`}>
                  {r.l}
                </button>
              )
            })}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Anonimizar pacientes sin visitas después de (meses)" hint="Se borran nombre y documento; los turnos quedan para estadísticas. 0 = nunca.">
            <input type="number" min={0} max={240} className={inputCls} value={s.patient_retention_months} onChange={(e) => set('patient_retention_months', Number(e.target.value))} />
          </Field>
          <Field label="Pasar turnos al archivo histórico después de (meses)" hint="Mantiene rápida la base. Las estadísticas se conservan en los resúmenes diarios.">
            <input type="number" min={3} max={120} className={inputCls} value={s.archive_after_months} onChange={(e) => set('archive_after_months', Number(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Direcciones de las pantallas" hint="Para equipos sin dirección fija. Lo recomendado es crear cada equipo en “Tótems y TVs”.">
        {[
          ['Tótem', '/totem'],
          ['Pantalla de sala (TV)', '/tv'],
          ['Pantalla de sala solo de ciertas secretarías', '/tv?sectors=1,2'],
          ['Panel de secretaria', '/panel'],
        ].map(([l, p]) => (
          <div key={p} className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{l}</div>
              <div className="truncate font-mono text-xs text-muted">{location.origin}{p}</div>
            </div>
            <Button variant="ghost" size="sm" aria-label={`Copiar ${l}`} onClick={() => copy(location.origin + p)}><Copy size={15} /></Button>
          </div>
        ))}
      </Section>

      <Section title="Mi cuenta">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña actual"><input type="password" className={inputCls} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="Contraseña nueva" hint="Mínimo 8 caracteres. Se cierran tus otras sesiones."><input type="password" className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <Button variant="soft" onClick={changePw} disabled={!pw.current || pw.next.length < 8}>Cambiar contraseña</Button>
      </Section>

      <Section title="Estado del sistema" hint="Conexión con la base de datos y datos del servidor.">
        {sys.data ? (
          <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            {(
              [
                ['Versión', sys.data.version],
                ['Base de datos', DB_LABEL[sys.data.db] ?? sys.data.db],
                ['Servidor', sys.data.server],
                ['Base', sys.data.database],
                ['Respuesta de la base', `${sys.data.dbLatencyMs} ms`],
                ['Tiempo real', sys.data.hub === 'redis' ? 'Redis (varias instancias)' : 'En memoria (una instancia)'],
                ['Pantallas conectadas', String(sys.data.wsClients)],
                ['Zona horaria', sys.data.timezone],
                ['Node.js', sys.data.node],
                ['Tiempo encendido', `${Math.floor(sys.data.uptimeSec / 3600)} h ${Math.floor((sys.data.uptimeSec % 3600) / 60)} min`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line/70 py-1.5">
                <dt className="text-muted">{k}</dt>
                <dd className="truncate font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        ) : sys.error ? <ErrorBox msg={sys.error} retry={sys.reload} /> : <Spinner />}
        <Button variant="soft" size="sm" onClick={sys.reload}>Verificar de nuevo</Button>
      </Section>

      <div className={`fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur transition lg:left-[16rem] ${dirty ? '' : 'translate-y-full opacity-0'}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-3">
          <span className="text-sm text-muted">Tenés cambios sin guardar</span>
          <Button variant="ghost" onClick={() => setS(JSON.parse(saved))}>Descartar</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar configuración'}</Button>
        </div>
      </div>
    </div>
  )
}

function LayoutThumb({ v }: { v: Settings['tv_layout'] }) {
  return (
    <div className="flex aspect-video overflow-hidden rounded-md bg-slate-900 p-1">
      {v === 'media' ? (
        <div className="relative flex-1 rounded-sm bg-gradient-to-br from-slate-600 to-slate-700">
          <div className="absolute inset-x-[30%] inset-y-[30%] rounded-sm bg-teal-500" />
        </div>
      ) : (
        <>
          <div className="grid flex-1 place-items-center"><div className="h-1/2 w-2/3 rounded-sm bg-teal-500" /></div>
          <div className="flex w-[35%] flex-col gap-0.5 border-l border-white/10 pl-1">
            {v === 'split' && <div className="h-1/3 rounded-sm bg-slate-600" />}
            {[0, 1, 2].map((i) => <div key={i} className="h-1.5 rounded-sm bg-white/20" />)}
          </div>
        </>
      )}
    </div>
  )
}
