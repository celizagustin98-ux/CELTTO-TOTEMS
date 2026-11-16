import { useCallback, useEffect, useRef, useState } from 'react'
import { BellOff, Volume2 } from 'lucide-react'
import { api, type CallTicket, type Settings } from '../lib/api'
import { clock, longDate, textOn } from '../lib/format'
import { useLive, useNow } from '../lib/live'
import { Announcer, fillTemplate } from '../lib/sound'

interface TvState {
  settings: Pick<Settings, 'org_name' | 'tv_voice_enabled' | 'tv_chime_enabled' | 'tv_voice_template' | 'tv_voice_rate' | 'tv_chime_volume' | 'tv_history_size'>
  recent: (Omit<CallTicket, 'at'> & { at: string })[]
  waiting: { sectorId: number; name: string; color: string; count: number }[]
}

export default function Tv() {
  const now = useNow(10000)
  const filter = new URLSearchParams(location.search).get('sectors') ?? ''
  const ids = filter.split(',').map(Number).filter((n) => n > 0)
  const [st, setSt] = useState<TvState | null>(null)
  const [featured, setFeatured] = useState<{ t: Omit<CallTicket, 'at'>; recall: boolean } | null>(null)
  const [flash, setFlash] = useState(0)
  const [locked, setLocked] = useState(false)
  const stRef = useRef<TvState | null>(null)
  stRef.current = st
  const ann = useRef<Announcer | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const load = useCallback(async () => {
    try { setSt(await api<TvState>(`/api/public/tv${filter ? `?sectors=${encodeURIComponent(filter)}` : ''}`)) } catch {  }
  }, [filter])
  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])
  useEffect(() => { ann.current = new Announcer(); const t = setTimeout(() => setLocked(!ann.current?.ready), 400); return () => clearTimeout(t) }, [])
  useEffect(() => { if (!featured && st?.recent[0]) setFeatured({ t: st.recent[0], recall: false }) }, [st, featured])

  useLive((m) => {
    if (m.type === 'config' || m.type === 'queue') { clearTimeout(timer.current); timer.current = setTimeout(load, 250); return }
    if (m.type !== 'call') return
    if (ids.length && !ids.includes(m.ticket.sectorId)) return
    setFeatured({ t: m.ticket, recall: m.recall }); setFlash((n) => n + 1)
    const s = stRef.current?.settings
    if (!s || !ann.current) return
    const wait = s.tv_chime_enabled ? ann.current.chime(s.tv_chime_volume) : 0
    if (s.tv_voice_enabled) setTimeout(() => ann.current?.speak(fillTemplate(s.tv_voice_template, m.ticket), s.tv_voice_rate), wait)
  })

  const unlock = async () => { await ann.current?.unlock(); setLocked(false) }
  const f = featured?.t
  const history = (st?.recent ?? []).filter((r) => r.id !== f?.id).slice(0, st?.settings.tv_history_size ?? 6)
  const muted = st && !st.settings.tv_chime_enabled && !st.settings.tv_voice_enabled

  return (
    <div className="grid h-full grid-cols-1 bg-ink text-white lg:grid-cols-[1fr_28rem]">
      <section key={flash} className={`flex min-h-[60vh] flex-col justify-between p-[4vmin] ${flash ? 'call-in' : ''}`} style={{ background: f ? f.color : '#16314a', color: f ? textOn(f.color) : '#fff' }} aria-live="assertive">
        {f ? (
          <>
            <div className="display text-[4vmin] font-medium opacity-85">{featured?.recall ? 'Llamando nuevamente' : 'Turno'}</div>
            <div className="num text-[min(34vmin,30vw)] leading-[0.85]">{f.code}</div>
            <div>
              <div className="display text-[7vmin] font-semibold leading-none">{f.sectorName}</div>
              {f.desk && <div className="display mt-[1.5vmin] text-[5.5vmin] opacity-90">{f.desk}</div>}
            </div>
          </>
        ) : (
          <div className="m-auto text-center"><div className="display text-[6vmin] font-semibold">Esperando el primer llamado</div><div className="mt-2 text-[3vmin] opacity-70">Cuando se llame un turno, aparece acá.</div></div>
        )}
      </section>

      <aside className="flex flex-col bg-ink p-[3vmin] lg:p-8">
        <div className="flex items-start justify-between">
          <div className="display text-2xl font-semibold leading-tight">{st?.settings.org_name ?? 'CELTTO-TOTEMS'}</div>
          <div className="text-right"><div className="num text-4xl leading-none">{clock(new Date(now))}</div><div className="mt-1 text-sm text-white/60 first-letter:uppercase">{longDate(new Date(now))}</div></div>
        </div>
        <h2 className="display mb-3 mt-8 text-lg font-semibold text-white/70">Últimos llamados</h2>
        <ul className="flex-1 space-y-2.5 overflow-hidden">
          {history.length === 0 && <li className="text-white/50">Todavía no hubo llamados.</li>}
          {history.map((r) => (
            <li key={r.id + r.at} className="flex items-stretch overflow-hidden rounded-xl bg-white/8">
              <span className="w-2.5 shrink-0" style={{ background: r.color }} />
              <span className="num px-4 py-3 text-4xl leading-none">{r.code}</span>
              <span className="flex flex-1 flex-col justify-center pr-4 text-right leading-tight"><span className="text-base font-medium">{r.sectorName}</span>{r.desk && <span className="text-sm text-white/60">{r.desk}</span>}</span>
            </li>
          ))}
        </ul>
        {st && st.waiting.length > 0 && (
          <div className="mt-6 border-t border-white/10 pt-5">
            <h2 className="display mb-3 text-lg font-semibold text-white/70">En espera</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
              {st.waiting.map((w) => <li key={w.sectorId} className="flex items-center gap-2.5 text-base"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: w.color }} /><span className="min-w-0 flex-1 truncate text-white/85">{w.name}</span><span className="num text-xl">{w.count}</span></li>)}
            </ul>
          </div>
        )}
        {muted && <div className="mt-4 flex items-center gap-2 text-xs text-white/40"><BellOff size={14} />Sonido y voz desactivados</div>}
      </aside>

      {locked && (
        <button onClick={unlock} className="fixed inset-0 z-50 grid place-items-center bg-ink/92 text-white">
          <span className="flex flex-col items-center gap-4 text-center"><Volume2 size={56} /><span className="display text-4xl font-semibold">Tocá la pantalla para activar el sonido</span><span className="max-w-md text-white/65">El navegador necesita un toque para poder reproducir sonido y voz. Se pide una sola vez.</span></span>
        </button>
      )}
    </div>
  )
}
