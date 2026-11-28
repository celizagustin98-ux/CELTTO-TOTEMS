import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BellOff, BellRing, Megaphone, Volume2, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type CallTicket, type Settings } from '../lib/api'
import { clock, longDate, textOn } from '../lib/format'
import { useDebounced, useLive, useNow } from '../lib/live'
import { Announcer, fillTemplate } from '../lib/sound'
import { isLang, setAppLanguage } from '../i18n'
import { Logo } from '../components/Brand'

type Recent = Omit<CallTicket, 'at'> & { at: string }
interface TvState {
  sectorIds: number[]
  settings: Pick<Settings, 'org_name' | 'brand_color' | 'tv_voice_enabled' | 'tv_chime_enabled' | 'tv_voice_template' | 'tv_voice_rate' | 'tv_chime_volume' | 'tv_history_size' | 'tv_media_enabled' | 'tv_media_interval_sec' | 'tv_layout' | 'tv_ticker'> & { tv_media: { url: string; kind: 'image' | 'video' }[] }
  recent: Recent[]
  waiting: { sectorId: number; name: string; color: string; count: number }[]
}

/** Segundos que el llamado se muestra encima de la publicidad. */
const OVERLAY_MS = 9_000
const FRESH_MS = 20_000

export default function Tv() {
  const { t } = useTranslation()
  const now = useNow(1_000)
  const { deviceKey: routeKey } = useParams()
  const params = new URLSearchParams(location.search)
  const filter = params.get('sectors') ?? ''
  const deviceKey = routeKey || params.get('deviceKey') || ''
  const [stationErr, setStationErr] = useState('')
  const [st, setSt] = useState<TvState | null>(null)
  const [featured, setFeatured] = useState<{ t: Omit<CallTicket, 'at'>; recall: boolean; at: number } | null>(null)
  const [locked, setLocked] = useState(true)
  const stRef = useRef<TvState | null>(null)
  stRef.current = st
  const ann = useRef<Announcer | null>(null)
  const [logoVersion, setLogoVersion] = useState<string | null | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams()
      if (filter) q.set('sectors', filter)
      if (deviceKey) q.set('deviceKey', deviceKey)
      setSt(await api<TvState>(`/api/public/tv${q.toString() ? `?${q}` : ''}`))
    } catch {
      /* sin conexión: se reintenta */
    }
  }, [filter, deviceKey])
  const reloadSoon = useDebounced(load, 400)
  const loadBrand = useCallback(() => {
    api<{ logoVersion: string | null }>('/api/public/sectors').then((d) => setLogoVersion(d.logoVersion)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!routeKey) return
    let stop = false
    const ping = async () => {
      try {
        const s = await api<{ kind: string; name: string; lang: string | null }>(`/api/public/stations/${encodeURIComponent(routeKey)}`)
        if (stop) return
        if (s.kind !== 'tv') return setStationErr('Esta dirección es de un tótem, no de una TV')
        setStationErr('')
        if (isLang(s.lang)) setAppLanguage(s.lang, false)
      } catch (e) {
        if (!stop) setStationErr((e as Error).message || 'TV no configurada')
      }
    }
    void ping()
    const id = setInterval(ping, 120_000)
    return () => { stop = true; clearInterval(id) }
  }, [routeKey])

  useEffect(() => {
    void load()
    loadBrand()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load, loadBrand])

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  useEffect(() => {
    ann.current = new Announcer()
    void ann.current.unlock().then((ok) => ok && setLocked(false))
  }, [])

  useEffect(() => {
    if (!featured && st?.recent[0]) setFeatured({ t: st.recent[0], recall: false, at: 0 })
  }, [st, featured])

  const connected = useLive((m) => {
    if (m.type === 'config') { reloadSoon(); loadBrand(); return }
    if (m.type === 'queue') {
      const mine = stRef.current?.sectorIds ?? []
      if (!mine.length || !m.sectorIds?.length || m.sectorIds.some((id) => mine.includes(id))) reloadSoon()
      return
    }
    if (m.type !== 'call') return
    const mine = stRef.current?.sectorIds ?? []
    if (mine.length && !mine.includes(m.ticket.sectorId)) return
    setFeatured({ t: m.ticket, recall: m.recall, at: Date.now() })
    const s = stRef.current?.settings
    if (s && ann.current)
      ann.current.announce({ text: fillTemplate(s.tv_voice_template || t('voice.template'), m.ticket), rate: s.tv_voice_rate, volume: s.tv_chime_volume, chime: s.tv_chime_enabled, voice: s.tv_voice_enabled })
  })

  if (routeKey && stationErr) {
    return (
      <div className="grid h-full place-items-center bg-night p-8 text-center text-white">
        <div>
          <div className="display text-4xl">{t('tv.notConfigured')}</div>
          <p className="mt-3 text-lg text-white/70">{stationErr}</p>
        </div>
      </div>
    )
  }

  const s = st?.settings
  const brand = s?.brand_color ?? '#0f766e'
  const media = s?.tv_media_enabled ? s.tv_media ?? [] : []
  const hasMedia = media.length > 0 && s?.tv_layout !== 'calls'
  const fullMedia = hasMedia && s?.tv_layout === 'media'
  const muted = s && !s.tv_chime_enabled && !s.tv_voice_enabled
  const history = (st?.recent ?? []).filter((r) => r.id !== featured?.t.id).slice(0, s?.tv_history_size ?? 6)
  const color = featured?.t.color ?? brand
  const overlay = !!featured && featured.at > 0 && now - featured.at < OVERLAY_MS
  const fresh = !!featured && featured.at > 0 && now - featured.at < FRESH_MS

  const CallCard = ({ big }: { big?: boolean }) =>
    featured ? (
      <motion.div
        key={`${featured.t.id}-${featured.at}`}
        initial={{ opacity: 0, y: 20, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className={`relative overflow-hidden rounded-[1.75rem] shadow-2xl ${fresh ? 'glow-pulse' : ''}`}
        style={{ background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 65%, black))`, color: textOn(color), ['--glow' as string]: color }}
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className={big ? 'p-10' : 'p-6'}>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] opacity-85">
            {fresh ? <BellRing size={16} className="pulse-dot" /> : <Megaphone size={16} />}
            {featured.recall ? t('tv.recall') : t('tv.nowCalling')}
          </div>
          <div className={`num leading-none ${big ? 'mt-4 text-[clamp(6rem,15vw,13rem)]' : 'mt-2 text-[clamp(4rem,7vw,7rem)]'}`}>{featured.t.code}</div>
          <div className={`font-semibold ${big ? 'mt-5 text-[clamp(1.6rem,3vw,2.8rem)]' : 'mt-3 text-[clamp(1.1rem,1.7vw,1.6rem)]'}`}>
            {t('tv.goTo')} {featured.t.sectorName}
          </div>
          {featured.t.desk && (
            <div className={`mt-2 inline-flex items-center rounded-xl bg-black/20 px-4 py-1.5 font-bold ${big ? 'text-4xl' : 'text-2xl'}`}>{featured.t.desk}</div>
          )}
        </div>
      </motion.div>
    ) : (
      <div className="grid place-items-center rounded-[1.75rem] border border-dashed border-white/15 p-10 text-center text-white/45">
        <div>
          <Megaphone size={36} className="mx-auto mb-3 opacity-60" />
          <div className="text-xl">{t('tv.waitingCalls')}</div>
        </div>
      </div>
    )

  const History = (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-white/50">{t('tv.history')}</h2>
      <ul className="min-h-0 flex-1 space-y-2 overflow-hidden">
        {history.length === 0 && <li className="text-white/35">—</li>}
        <AnimatePresence initial={false}>
          {history.map((r) => {
            const mins = Math.floor((now - Date.parse(r.at)) / 60000)
            return (
              <motion.li key={r.id + r.at} layout initial={{ opacity: 0, x: 30, height: 0 }} animate={{ opacity: 1, x: 0, height: 'auto' }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }} className="flex items-stretch overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/[0.06]">
                <span className="w-2 shrink-0" style={{ background: r.color }} />
                <span className="num px-4 py-3 text-[2.4rem] leading-none">{r.code}</span>
                <span className="flex min-w-0 flex-1 flex-col justify-center pr-4 text-right leading-tight">
                  <span className="truncate text-lg font-medium">{r.sectorName}{r.desk ? ` · ${r.desk}` : ''}</span>
                  <span className="text-sm text-white/45">{mins < 1 ? t('tv.now') : t('tv.ago', { n: mins })}</span>
                </span>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )

  const Waiting = st && st.waiting.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {st.waiting.map((w) => (
        <div key={w.sectorId} className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/[0.06]">
          <span className="h-3 w-3 rounded" style={{ background: w.color }} />
          <span className="text-base text-white/80">{w.name}</span>
          <span className="num text-2xl">{w.count}</span>
          <span className="text-xs text-white/40">{t('tv.waiting').toLowerCase()}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="relative flex h-full flex-col overflow-clip bg-night text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 top-1/3 h-[36rem] w-[36rem] rounded-full blur-3xl" style={{ background: `${brand}26` }} />
        <motion.div key={featured?.at ?? 0} initial={{ opacity: 0.55 }} animate={{ opacity: 0 }} transition={{ duration: 2 }} className="absolute inset-0" style={{ background: `radial-gradient(circle at 70% 40%, ${color}55, transparent 60%)` }} />
      </div>

      {/* Encabezado */}
      <header className="relative z-10 flex items-center justify-between gap-6 px-8 pb-2 pt-6">
        <div className="flex min-w-0 items-center gap-4">
          <Logo version={logoVersion} className="h-14 w-14" />
          <div className="min-w-0">
            <div className="display truncate text-[2rem] font-semibold leading-tight">{s?.org_name ?? t('app.name')}</div>
            {Waiting && <div className="mt-1 hidden xl:block">{Waiting}</div>}
          </div>
        </div>
        <div className="flex items-center gap-5">
          {!connected && <span className="flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1.5 text-sm text-red-200"><WifiOff size={15} /> {t('tv.offline')}</span>}
          {muted && <BellOff size={18} className="text-white/40" aria-label={t('tv.soundOff')} />}
          <div className="text-right">
            <div className="num text-6xl leading-none">{clock(now)}</div>
            <div className="mt-1 text-base text-white/55 first-letter:uppercase">{longDate(now)}</div>
          </div>
        </div>
      </header>

      {/* Contenido */}
      <div className="relative z-10 flex min-h-0 flex-1 gap-6 p-8 pt-4 portrait:flex-col">
        {hasMedia ? (
          <>
            <section className={`relative flex min-h-0 flex-col ${fullMedia ? 'flex-1' : 'flex-[1.85]'}`}>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.2em] text-white/40">
                <span className="h-1.5 w-1.5 rounded-full bg-white/40" /> {t('tv.advertising')}
              </div>
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.75rem] bg-black/50 shadow-2xl ring-1 ring-white/10">
                <TvMedia urls={media} intervalSec={s?.tv_media_interval_sec || 20} />
                {/* Aviso de llamado encima de la publicidad */}
                <AnimatePresence>
                  {overlay && featured && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-night/70 p-8 backdrop-blur-md">
                      <motion.div initial={{ scale: 0.7, y: 40 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }} className="w-full max-w-3xl">
                        <CallCard big />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>
            {!fullMedia && (
              <aside className="flex min-h-0 flex-1 flex-col gap-5 portrait:flex-none">
                <CallCard />
                {History}
                <div className="xl:hidden">{Waiting}</div>
              </aside>
            )}
            {fullMedia && (
              <aside className="flex w-[24rem] min-h-0 flex-col gap-4 portrait:w-auto">
                <CallCard />
                {History}
              </aside>
            )}
          </>
        ) : (
          <>
            <section className="flex flex-[1.6] items-center justify-center">
              <div className="w-full max-w-4xl"><AnimatePresence mode="wait"><CallCard big /></AnimatePresence></div>
            </section>
            <aside className="flex min-h-0 flex-1 flex-col gap-5 rounded-[1.75rem] bg-white/[0.03] p-6 ring-1 ring-white/[0.06]">
              {History}
              <div className="xl:hidden">{Waiting}</div>
            </aside>
          </>
        )}
      </div>

      {s?.tv_ticker?.trim() && (
        <div className="relative z-10 flex shrink-0 items-center overflow-hidden border-t border-white/10 text-xl" style={{ background: `color-mix(in srgb, ${brand} 30%, #0b1220)` }}>
          <span className="z-10 shrink-0 self-stretch px-5 py-3 text-sm font-bold uppercase tracking-widest" style={{ background: brand, color: textOn(brand) }}>Info</span>
          <div className="min-w-0 flex-1 overflow-hidden py-3">
            <div className="ticker-track" style={{ ['--ticker-dur' as string]: `${Math.max(20, s.tv_ticker.length * 0.35)}s` }}>
              {[0, 1].map((i) => <span key={i} className="px-12">{s.tv_ticker}</span>)}
            </div>
          </div>
        </div>
      )}

      {locked && (
        <button onClick={() => void ann.current?.unlock().then(() => setLocked(false))} className="fixed inset-0 z-50 grid place-items-center bg-night/95 text-white">
          <span className="flex flex-col items-center gap-5 px-6 text-center">
            <span className="grid h-24 w-24 place-items-center rounded-full bg-white/10"><Volume2 size={48} /></span>
            <span className="display text-4xl font-semibold">{t('tv.enableSound')}</span>
            <span className="max-w-lg text-lg text-white/60">{t('tv.enableSoundHint')}</span>
          </span>
        </button>
      )}
    </div>
  )
}

/**
 * Carrusel de publicidad: las imágenes duran N segundos y los videos se reproducen completos (sin sonido)
 * antes de pasar al siguiente. Barra de progreso abajo.
 */
function TvMedia({ urls, intervalSec }: { urls: { url: string; kind: 'image' | 'video' }[]; intervalSec: number }) {
  const [i, setI] = useState(0)
  const [progress, setProgress] = useState(0)
  const item = urls[i % Math.max(1, urls.length)]
  const next = useCallback(() => {
    setProgress(0)
    setI((x) => (x + 1) % Math.max(1, urls.length))
  }, [urls.length])
  useEffect(() => {
    if (!item || item.kind === 'video' || urls.length <= 1) return
    const id = setTimeout(next, intervalSec * 1000)
    return () => clearTimeout(id)
  }, [item, intervalSec, next, urls.length])
  if (!item) return null
  return (
    <>
      <AnimatePresence mode="sync">
        <motion.div key={item.url + i} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} className="absolute inset-0">
          {item.kind === 'video' ? (
            <video
              src={item.url}
              className="h-full w-full object-cover"
              autoPlay
              muted
              playsInline
              loop={urls.length === 1}
              onEnded={next}
              onError={next}
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                if (v.duration) setProgress(v.currentTime / v.duration)
              }}
            />
          ) : (
            <img src={item.url} alt="" className="h-full w-full object-cover" onError={next} />
          )}
        </motion.div>
      </AnimatePresence>
      {urls.length > 1 && (
        <div className="absolute inset-x-6 bottom-4 flex gap-1.5">
          {urls.map((u, k) => (
            <div key={u.url + k} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              {k === i % urls.length &&
                (item.kind === 'video' ? (
                  <div className="h-full bg-white transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
                ) : (
                  <div key={i} className="h-full bg-white" style={{ animation: `grow ${intervalSec}s linear forwards` }} />
                ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
