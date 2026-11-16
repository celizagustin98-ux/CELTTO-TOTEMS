import { useEffect, useRef, useState } from 'react'
import { Copy, Volume2 } from 'lucide-react'
import { api, type Settings } from '../lib/api'
import { useLoad } from '../lib/live'
import { Announcer, fillTemplate } from '../lib/sound'
import { Button, Card, ErrorBox, Field, Spinner, Toggle, inputCls, useToast } from '../ui'

interface Sys { db: string; dbLatencyMs: number; server: string; database: string; timezone: string; wsClients: number; node: string; uptimeSec: number }
const TOKENS = ['{prefix}', '{number}', '{code}', '{sector}', '{desk}', '{place}']

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <Card className="p-5 sm:p-6"><h2 className="display text-xl font-semibold">{title}</h2>{hint && <p className="mb-3 text-sm text-muted">{hint}</p>}<div className="mt-3 space-y-3">{children}</div></Card>
}

export default function SettingsPage() {
  const toast = useToast()
  const { data, error, loading } = useLoad(() => api<Settings>('/api/admin/settings'))
  const sys = useLoad(() => api<Sys>('/api/admin/system'))
  const [s, setS] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '' })
  const ann = useRef<Announcer | null>(null)
  useEffect(() => { if (data) setS(data) }, [data])

  if (loading || !s) return error ? <ErrorBox msg={error} /> : <Spinner />
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v })
  const save = async () => {
    setBusy(true)
    try { setS(await api<Settings>('/api/admin/settings', { method: 'PUT', body: s })); toast('Configuración guardada') } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const test = async () => {
    ann.current ??= new Announcer()
    await ann.current.unlock()
    const wait = s.tv_chime_enabled ? ann.current.chime(s.tv_chime_volume) : 0
    if (s.tv_voice_enabled) setTimeout(() => ann.current!.speak(fillTemplate(s.tv_voice_template, { code: 'A-014', prefix: 'A', number: 14, sectorName: 'Secretaría A', desk: 'Box 1' }), s.tv_voice_rate), wait)
    else if (!s.tv_chime_enabled) toast('El sonido y la voz están desactivados', 'error')
  }
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast('Dirección copiada'))
  const changePw = async () => {
    try { await api('/api/auth/password', { method: 'PUT', body: pw }); setPw({ current: '', next: '' }); toast('Contraseña actualizada') } catch (e) { toast((e as Error).message, 'error') }
  }

  return (
    <div className="space-y-6 pb-24">
      <header><h1 className="display text-3xl font-semibold">Configuración</h1><p className="text-sm text-muted">Lo que ves acá se aplica en el tótem y en la pantalla de sala al guardar.</p></header>

      <Section title="Pantalla de sala (TV)">
        <Toggle checked={s.tv_chime_enabled} onChange={(v) => set('tv_chime_enabled', v)} label="Sonido al llamar" hint="Suena una campanilla cada vez que se llama o se vuelve a llamar un turno." />
        <Toggle checked={s.tv_voice_enabled} onChange={(v) => set('tv_voice_enabled', v)} label="Voz al llamar" hint="La TV dice el turno en voz alta. Se puede desactivar sin perder el sonido." />
        <Field label="Frase que dice la voz" hint="Podés usar: {prefix} letra, {number} número, {code} turno completo, {sector}, {desk} puesto, {place} secretaría y puesto.">
          <input className={inputCls} value={s.tv_voice_template} onChange={(e) => set('tv_voice_template', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5">{TOKENS.map((t) => <button key={t} type="button" onClick={() => set('tv_voice_template', `${s.tv_voice_template} ${t}`.trim())} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-xs hover:bg-line/60">{t}</button>)}</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Velocidad de la voz (${s.tv_voice_rate.toFixed(2)})`}><input type="range" min={0.6} max={1.3} step={0.05} value={s.tv_voice_rate} onChange={(e) => set('tv_voice_rate', Number(e.target.value))} className="w-full" /></Field>
          <Field label={`Volumen del sonido (${Math.round(s.tv_chime_volume * 100)}%)`}><input type="range" min={0.1} max={1} step={0.05} value={s.tv_chime_volume} onChange={(e) => set('tv_chime_volume', Number(e.target.value))} className="w-full" /></Field>
          <Field label="Llamados en el historial"><input type="number" min={1} max={12} className={inputCls} value={s.tv_history_size} onChange={(e) => set('tv_history_size', Number(e.target.value))} /></Field>
        </div>
        <Button variant="soft" onClick={test}><Volume2 size={17} />Probar sonido y voz</Button>
        <p className="text-xs text-muted">La prueba usa el audio de esta computadora. La voz depende de las voces en español instaladas en la PC de la TV.</p>
      </Section>

      <Section title="Tótem y ticket">
        <Toggle checked={s.totem_auto_print} onChange={(v) => set('totem_auto_print', v)} label="Imprimir el ticket automáticamente" hint="Abre la impresión al sacar el turno. Para que salga sin diálogo, abrí Chrome del tótem con --kiosk-printing." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="PIN para cambiar la secretaría del tótem" hint="4 a 8 números. Se pide al tocar 5 veces la esquina superior izquierda del tótem."><input className={inputCls} inputMode="numeric" value={s.totem_pin} onChange={(e) => set('totem_pin', e.target.value.replace(/\D/g, '').slice(0, 8))} /></Field>
          <Field label="Segundos que se muestra el ticket"><input type="number" min={3} max={60} className={inputCls} value={s.totem_return_seconds} onChange={(e) => set('totem_return_seconds', Number(e.target.value))} /></Field>
        </div>
        <Field label="Texto al pie del ticket"><input className={inputCls} value={s.ticket_footer} onChange={(e) => set('ticket_footer', e.target.value)} /></Field>
        <Field label="Nombre de la institución" hint="Aparece en el tótem, la TV y el ticket."><input className={inputCls} value={s.org_name} onChange={(e) => set('org_name', e.target.value)} /></Field>
        {s.totem_pin === '0000' && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">El PIN sigue siendo el de fábrica (0000). Cambialo antes de poner el tótem en uso.</p>}
      </Section>

      <Section title="Direcciones de las pantallas" hint="Abrilas en la PC de cada tótem y en la TV de la sala.">
        {[['Tótem (una PC por secretaría)', '/totem'], ['Pantalla de sala (TV)', '/tv'], ['Pantalla de sala solo de ciertas secretarías', '/tv?sectors=1,2'], ['Panel de secretaria', '/panel']].map(([l, p]) => (
          <div key={p} className="flex items-center justify-between gap-3 rounded-lg bg-paper px-3 py-2.5"><div><div className="text-sm font-medium">{l}</div><div className="font-mono text-xs text-muted">{location.origin}{p}</div></div><Button variant="ghost" size="sm" aria-label={`Copiar ${l}`} onClick={() => copy(location.origin + p)}><Copy size={15} /></Button></div>
        ))}
        <p className="text-xs text-muted">En la pantalla filtrada, los números después de “sectors=” son los de cada secretaría separados por coma.</p>
      </Section>

      <Section title="Mi cuenta">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraseña actual"><input type="password" className={inputCls} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></Field>
          <Field label="Contraseña nueva" hint="Mínimo 8 caracteres."><input type="password" className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <Button variant="soft" onClick={changePw} disabled={!pw.current || pw.next.length < 8}>Cambiar contraseña</Button>
      </Section>

      <Section title="Estado del sistema" hint="Conexión con la base de datos y datos del servidor.">
        {sys.data ? (
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {([['Base de datos', sys.data.db === 'mssql' ? 'SQL Server' : 'SQLite (desarrollo)'], ['Servidor', sys.data.server], ['Base', sys.data.database], ['Respuesta de la base', `${sys.data.dbLatencyMs} ms`], ['Zona horaria', sys.data.timezone], ['Pantallas conectadas', String(sys.data.wsClients)], ['Node.js', sys.data.node], ['Tiempo encendido', `${Math.floor(sys.data.uptimeSec / 3600)} h ${Math.floor((sys.data.uptimeSec % 3600) / 60)} min`]] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line/70 py-1.5"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
          </dl>
        ) : sys.error ? <ErrorBox msg={sys.error} retry={sys.reload} /> : <Spinner />}
        <Button variant="soft" size="sm" onClick={sys.reload}>Verificar de nuevo</Button>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-5 py-3 backdrop-blur lg:left-64"><div className="mx-auto flex max-w-6xl justify-end"><Button onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar configuración'}</Button></div></div>
    </div>
  )
}
