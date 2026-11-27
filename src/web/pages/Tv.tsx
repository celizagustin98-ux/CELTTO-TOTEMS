import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { BellOff, Volume2, WifiOff } from 'lucide-react'
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
  settings: Pick<Settings, 'org_name' | 'brand_color' | 'tv_voice_enabled' | 'tv_chime_enabled' | 'tv_voice_template' | 'tv_voice_rate' | 'tv_chime_volume' | 'tv_history_size' | 'tv_media_enabled' | 'tv_media_interval_sec' | 'tv_layout' | 'tv_ticker'> & {
    tv_media_urls: string[]
  }
  recent: Recent[]
  waiting: { sectorId: number; name: string; color: string; count: number }[]
}

const FEATURE_MS = 15_000

export default function Tv() {
  const { t } = useTranslation()
  const now = useNow(10_000)
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
    api<{ logoVersion: string | null }>('/api/public/sectors')
      .then((d) => setLogoVersion(d.logoVersion))
      .catch(() => {})
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
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [routeKey])

  useEffect(() => {
    void load()
    loadBrand()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load, loadBrand])

  useEffect(() => {
    ann.current = new Announcer()
    // Con Chrome en modo kiosk (--autoplay-policy=no-user-gesture-required) el audio ya está habilitado
    void ann.current.unlock().then((ok) => ok && setLocked(false))
  }, [])

  useEffect(() => {
    if (!featured && st?.recent[0]) setFeatured({ t: st.recent[0], recall: false, at: 0 })
  }, [st, featured])

  const playCall = (ticket: Omit<CallTicket, 'at'>) => {
    const s = stRef.current?.settings
    if (!s || !ann.current) return
    ann.current.announce({
      text: fillTemplate(s.tv_voice_template || t('voice.template'), ticket),
      rate: s.tv_voice_rate,
      volume: s.tv_chime_volume,
      chime: s.tv_chime_enabled,
      voice: s.tv_voice_enabled,
    })
  }

  const connected = useLive((m) => {
    if (m.type === 'config') {
      reloadSoon()
      loadBrand()
      return
    }
    if (m.type === 'queue') {
      // Solo recargar si el cambio afecta a las secretarías que muestra esta TV
      const mine = stRef.current?.sectorIds ?? []
      if (!mine.length || !m.sectorIds?.length || m.sectorIds.some((id) => mine.includes(id))) reloadSoon()
      return
    }
    if (m.type !== 'call') return
    // Filtro por secretaría: usa lo que resolvió el servidor (URL ?sectors= o TV vinculada a una secretaría)
    const mine = stRef.current?.sectorIds ?? []
    if (mine.length && !mine.includes(m.ticket.sectorId)) return
    setFeatured({ t: m.ticket, recall: m.recall, at: Date.now() })
    playCall(m.ticket)
  })

  const unlock = async () => {
    await ann.current?.unlock()
    setLocked(false)
  }

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
  const layout = s?.tv_layout ?? 'split'
  const muted = s && !s.tv_chime_enabled && !s.tv_voice_enabled
  const history = (st?.recent ?? []).filter((r) => r.id !== featured?.t.id).slice(0, s?.tv_history_size ?? 6)
  const color = featured?.t.color ?? s?.brand_color ?? '#0f766e'
  const media = s?.tv_media_enabled ? s.tv_media_urls : []
  const fresh = featured && featured.at && now - featured.at < FEATURE_MS
  const showOverlay = layout === 'media' && media.length > 0 && featured && Date.now() - featured.at < FEATURE_MS

  const Header = (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Logo version={logoVersion} className="h-12 w-12" />
        <div className="display truncate text-2xl font-semibold leading-tight">{s?.org_name ?? t('app.name')}</div>
      </div>
      <div className="text-right">
        <div className="num text-5xl leading-none">{clock(now)}</div>
        <div className="mt-1 text-sm text-white/60 first-letter:uppercase">{longDate(now)}</div>
      </div>
    </div>
  )

  const Featured = featured ? (
    <motion.div
      key={`${featured.t.id}-${featured.at}`}
      initial={{ scale: 0.85, opacity: 0, y: 30 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.95, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 160, damping: 18 }}
      className="relative z-10 flex w-full max-w-4xl flex-col items-center text-center"
    >
      <motion.div animate={fresh ? { opacity: [0.4, 1, 0.4] } : {}} transition={{ repeat: 4, duration: 0.7 }} className="display mb-5 text-3xl font-semibold uppercase tracking-[0.2em] text-white/85">
        {featured.recall ? t('tv.recall') : t('tv.nowCalling')}
      </motion.div>
      <div className="stub w-full px-10 py-12 shadow-2xl" style={{ background: color, color: textOn(color) }}>
        <div className="num text-[clamp(5rem,16vw,12rem)] leading-none">{featured.t.code}</div>
        <div className="mt-5 text-[clamp(1.5rem,3vw,2.6rem)] font-semibold">
          {t('tv.goTo')} {featured.t.sectorName}
          {featured.t.desk ? ` · ${featured.t.desk}` : ''}
        </div>
      </div>
    </motion.div>
  ) : (
    <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-white/50">
      <div className="display text-4xl">{s?.org_name ?? t('app.name')}</div>
      <p className="mt-3 text-xl">{t('tv.waitingCalls')}</p>
    </motion.div>
  )

  const History = (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="display mb-3 text-lg font-semibold uppercase tracking-[0.14em] text-white/60">{t('tv.history')}</h2>
      <ul className="min-h-0 flex-1 space-y-2.5 overflow-hidden">
        {history.length === 0 && <li className="text-white/40">{t('tv.waitingCalls')}</li>}
        <AnimatePresence initial={false}>
          {history.map((r) => {
            const mins = Math.floor((now - Date.parse(r.at)) / 60000)
            return (
              <motion.li key={r.id + r.at} layout initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-stretch overflow-hidden rounded-2xl bg-white/[0.07]">
                <span className="w-2.5 shrink-0" style={{ background: r.color }} />
                <span className="num px-4 py-3 text-4xl leading-none">{r.code}</span>
                <span className="flex flex-1 flex-col justify-center pr-4 text-right leading-tight">
                  <span className="text-lg font-medium">
                    {r.sectorName}
                    {r.desk ? ` · ${r.desk}` : ''}
                  </span>
                  <span className="text-sm text-white/50">{mins < 1 ? t('tv.now') : t('tv.ago', { n: mins })}</span>
                </span>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )

  const Waiting =
    st && st.waiting.length > 0 ? (
      <div className="border-t border-white/10 pt-4">
        <h2 className="display mb-3 text-lg font-semibold uppercase tracking-[0.14em] text-white/60">{t('tv.waiting')}</h2>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
          {st.waiting.map((w) => (
            <li key={w.sectorId} className="flex items-center gap-2.5 text-lg">
              <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: w.color }} />
              <span className="min-w-0 flex-1 truncate text-white/85">{w.name}</span>
              <span className="num text-2xl">{w.count}</span>
            </li>
          ))}
        </ul>
      </div>
    ) : null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-night text-white">
      <div className="flex min-h-0 flex-1 portrait:flex-col">
        {layout === 'media' && media.length > 0 ? (
          <main className="relative flex flex-1 flex-col">
            <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent p-6">{Header}</div>
            <TvMedia urls={media} intervalSec={s?.tv_media_interval_sec || 20} className="h-full w-full" />
            <AnimatePresence>
              {showOverlay && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 grid place-items-center bg-night/80 p-10 backdrop-blur-sm">
                  {Featured}
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        ) : (
          <main className="relative flex flex-1 flex-col overflow-hidden p-8 portrait:flex-none portrait:min-h-[55%]">
            <div className="mb-4 landscape:hidden">{Header}</div>
            <div className="flex flex-1 items-center justify-center">
              <AnimatePresence mode="wait">{Featured}</AnimatePresence>
            </div>
            <motion.div key={featured?.at ?? 0} initial={{ opacity: 0.4 }} animate={{ opacity: 0 }} transition={{ duration: 1.4 }} className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at center, ${color}66, transparent 60%)` }} />
          </main>
        )}

        <aside
          className={`flex flex-col gap-5 border-white/10 bg-black/30 p-6 backdrop-blur-sm landscape:w-[28rem] landscape:max-w-[36%] landscape:border-l portrait:min-h-0 portrait:flex-1 portrait:border-t ${
            layout === 'media' && media.length > 0 ? '' : ''
          }`}
        >
          <div className="portrait:hidden">{Header}</div>
          {layout === 'split' && media.length > 0 && (
            <div className="aspect-video shrink-0 overflow-hidden rounded-2xl bg-black/40">
              <TvMedia urls={media} intervalSec={s?.tv_media_interval_sec || 20} className="h-full w-full" />
            </div>
          )}
          {layout === 'media' && media.length > 0 && featured && !showOverlay && (
            <div className="rounded-2xl p-4" style={{ background: color, color: textOn(color) }}>
              <div className="text-sm font-semibold uppercase tracking-widest opacity-80">{t('tv.nowCalling')}</div>
              <div className="num text-6xl leading-none">{featured.t.code}</div>
              <div className="mt-1 text-lg">{featured.t.sectorName}{featured.t.desk ? ` · ${featured.t.desk}` : ''}</div>
            </div>
          )}
          {History}
          {Waiting}
          <div className="flex items-center gap-4 text-xs text-white/40">
            {muted && (
              <span className="flex items-center gap-1.5">
                <BellOff size={14} /> {t('tv.soundOff')}
              </span>
            )}
            {!connected && (
              <span className="flex items-center gap-1.5 text-red-300">
                <WifiOff size={14} /> {t('tv.offline')}
              </span>
            )}
          </div>
        </aside>
      </div>

      {s?.tv_ticker?.trim() && (
        <div className="relative shrink-0 overflow-hidden border-t border-white/10 py-3 text-xl" style={{ background: `color-mix(in srgb, ${s.brand_color} 35%, #0b1220)` }}>
          <div className="ticker-track" style={{ ['--ticker-dur' as string]: `${Math.max(20, s.tv_ticker.length * 0.35)}s` }}>
            {[0, 1].map((i) => (
              <span key={i} className="px-12">
                {s.tv_ticker}
              </span>
            ))}
          </div>
        </div>
      )}

      {locked && (
        <button onClick={() => void unlock()} className="fixed inset-0 z-50 grid place-items-center bg-night/95 text-white">
          <span className="flex flex-col items-center gap-5 px-6 text-center">
            <span className="grid h-24 w-24 place-items-center rounded-full bg-white/10">
              <Volume2 size={48} />
            </span>
            <span className="display text-4xl font-semibold">{t('tv.enableSound')}</span>
            <span className="max-w-lg text-lg text-white/60">{t('tv.enableSoundHint')}</span>
          </span>
        </button>
      )}
    </div>
  )
}

function TvMedia({ urls, intervalSec, className = '' }: { urls: string[]; intervalSec: number; className?: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (urls.length <= 1) return
    const id = setInterval(() => setI((x) => (x + 1) % urls.length), intervalSec * 1000)
    return () => clearInterval(id)
  }, [urls.length, intervalSec])
  const src = urls[i % urls.length]
  if (!src) return null
  const isVideo = /\.(mp4|webm|ogg)(\?|$)/i.test(src)
  return (
    <AnimatePresence mode="wait">
      <motion.div key={src} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} className={className}>
        {isVideo ? <video src={src} className="h-full w-full object-cover" autoPlay muted loop playsInline /> : <img src={src} alt="" className="h-full w-full object-cover" />}
      </motion.div>
    </AnimatePresence>
  )
}
