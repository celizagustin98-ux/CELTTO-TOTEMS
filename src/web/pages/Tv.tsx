import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { BellOff, Volume2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api, type CallTicket, type Settings } from '../lib/api'
import { clock, longDate, textOn } from '../lib/format'
import { useLive, useNow } from '../lib/live'
import { Announcer, fillTemplate } from '../lib/sound'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import i18n from '../i18n'

interface TvState {
  settings: Pick<
    Settings,
    | 'org_name'
    | 'tv_voice_enabled'
    | 'tv_chime_enabled'
    | 'tv_voice_template'
    | 'tv_voice_rate'
    | 'tv_chime_volume'
    | 'tv_history_size' | 'tv_media_enabled' | 'tv_media_urls' | 'tv_media_interval_sec'
  >
  recent: (Omit<CallTicket, 'at'> & { at: string })[]
  waiting: { sectorId: number; name: string; color: string; count: number }[]
}

export default function Tv() {
  const { t } = useTranslation()
  const now = useNow(10000)
  const { deviceKey: routeKey } = useParams()
  const params = new URLSearchParams(location.search)
  const filter = params.get('sectors') ?? ''
  const ids = filter.split(',').map(Number).filter((n) => n > 0)
  const deviceKey = routeKey || params.get('deviceKey') || localStorage.getItem('celtto.tv.device') || ''
  const [stationName, setStationName] = useState<string | null>(null)
  const [stationErr, setStationErr] = useState('')
  const [st, setSt] = useState<TvState | null>(null)
  const [featured, setFeatured] = useState<{ t: Omit<CallTicket, 'at'>; recall: boolean } | null>(null)
  const [flash, setFlash] = useState(0)
  const [locked, setLocked] = useState(true)
  const stRef = useRef<TvState | null>(null)
  stRef.current = st
  const ann = useRef<Announcer | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams()
      if (filter) q.set('sectors', filter)
      if (deviceKey) q.set('deviceKey', deviceKey)
      setSt(await api<TvState>(`/api/public/tv${q.toString() ? `?${q}` : ''}`))
    } catch {
      /* offline: se reintenta */
    }
  }, [filter, deviceKey])

  useEffect(() => {
    if (!routeKey) return
    let stop = false
    const ping = async () => {
      try {
        const st = await api<{ kind: string; name: string; sectorId: number | null }>(`/api/public/stations/${encodeURIComponent(routeKey)}`)
        if (stop) return
        if (st.kind !== 'tv') {
          setStationErr('Esta URL no es de una TV')
          return
        }
        setStationName(st.name)
        setStationErr('')
        localStorage.setItem('celtto.tv.device', routeKey)
      } catch (e: any) {
        if (!stop) setStationErr(e.message || 'TV no configurada')
      }
    }
    void ping()
    const t = setInterval(ping, 120000)
    return () => { stop = true; clearInterval(t) }
  }, [routeKey])


  useEffect(() => {
    void load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    ann.current = new Announcer()
  }, [])

  useEffect(() => {
    if (!featured && st?.recent[0]) setFeatured({ t: st.recent[0], recall: false })
  }, [st, featured])

  const playCall = (ticket: Omit<CallTicket, 'at'>, recall: boolean) => {
    const s = stRef.current?.settings
    if (!s || !ann.current) return
    const template = s.tv_voice_template || t('voice.template')
    const text = fillTemplate(template, ticket)
    ann.current.announce({
      text,
      rate: s.tv_voice_rate,
      volume: s.tv_chime_volume,
      chime: s.tv_chime_enabled,
      voice: s.tv_voice_enabled,
      langCode: i18n.language,
    })
  }

  useLive((m) => {
    if (m.type === 'config' || m.type === 'queue') {
      clearTimeout(timer.current)
      timer.current = setTimeout(load, 250)
      return
    }
    if (m.type !== 'call') return
    if (ids.length && !ids.includes(m.ticket.sectorId)) return
    setFeatured({ t: m.ticket, recall: m.recall })
    setFlash((n) => n + 1)
    playCall(m.ticket, m.recall)
  })

  const unlock = async () => {
    await ann.current?.unlock()
    setLocked(false)
  }

  const muted = st && !st.settings.tv_chime_enabled && !st.settings.tv_voice_enabled
  const history = st?.recent.slice(0, st.settings.tv_history_size ?? 6) ?? []
  const color = featured?.t.color ?? '#2f6fed'

  if (routeKey && stationErr) {
    return (
      <div className="grid h-full place-items-center bg-ink p-8 text-center text-white">
        <div>
          <div className="display text-3xl">TV no configurada</div>
          <p className="mt-2 text-white/70">{stationErr}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full bg-ink text-white">
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden p-8">
        <AnimatePresence mode="wait">
          {featured ? (
            <motion.div
              key={`${featured.t.id}-${flash}`}
              initial={{ scale: 0.85, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 160, damping: 18 }}
              className="relative z-10 flex w-full max-w-4xl flex-col items-center text-center"
            >
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: 3, duration: 0.6 }}
                className="display mb-4 text-2xl font-semibold tracking-wide text-white/80"
              >
                {featured.recall ? t('tv.recall') : t('tv.nowCalling')}
              </motion.div>
              <div
                className="stub w-full max-w-3xl px-10 py-12 shadow-2xl"
                style={{ background: color, color: textOn(color) }}
              >
                <div className="num text-[clamp(4rem,14vw,9rem)] leading-none font-bold tracking-tight">{featured.t.code}</div>
                <div className="mt-4 text-2xl font-medium opacity-95">
                  {featured.t.sectorName}
                  {featured.t.desk ? ` · ${featured.t.desk}` : ''}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-white/50">
              <div className="display text-3xl">{st?.settings.org_name ?? t('app.name')}</div>
              <p className="mt-2 text-lg">{t('tv.waiting')}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          key={flash}
          initial={{ opacity: 0.35 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(circle at center, ${color}55, transparent 60%)` }}
        />
      </main>

      <aside className="flex w-full max-w-md flex-col border-l border-white/10 bg-black/30 p-6 backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="display text-2xl font-semibold leading-tight">{st?.settings.org_name ?? t('app.name')}</div>
          <div className="text-right">
            <div className="num text-4xl leading-none">{clock(new Date(now))}</div>
            <div className="mt-1 text-sm text-white/60 first-letter:uppercase">{longDate(new Date(now))}</div>
          </div>
        </div>
        <div className="mt-3">
          <LanguageSwitcher className="text-white/80" />
        </div>
        {st?.settings.tv_media_enabled && (st.settings.tv_media_urls || '').trim() && (
          <div className="mt-4 overflow-hidden rounded-xl bg-black/40 aspect-video">
            <TvMedia urls={st.settings.tv_media_urls} intervalSec={st.settings.tv_media_interval_sec || 20} />
          </div>
        )}
        <h2 className="display mb-3 mt-6 text-lg font-semibold text-white/70">{t('tv.history')}</h2>
        <ul className="flex-1 space-y-2.5 overflow-hidden">
          {history.length === 0 && <li className="text-white/50">{t('tv.waiting')}</li>}
          <AnimatePresence initial={false}>
            {history.map((r) => (
              <motion.li
                key={r.id + r.at}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-stretch overflow-hidden rounded-xl bg-white/8"
              >
                <span className="w-2.5 shrink-0" style={{ background: r.color }} />
                <span className="num px-4 py-3 text-4xl leading-none">{r.code}</span>
                <span className="flex flex-1 flex-col justify-center pr-4 text-right leading-tight">
                  <span className="text-base font-medium">{r.sectorName}</span>
                  {r.desk && <span className="text-sm text-white/60">{r.desk}</span>}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {st && st.waiting.length > 0 && (
          <div className="mt-6 border-t border-white/10 pt-5">
            <h2 className="display mb-3 text-lg font-semibold text-white/70">{t('tv.waiting')}</h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
              {st.waiting.map((w) => (
                <li key={w.sectorId} className="flex items-center gap-2.5 text-base">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: w.color }} />
                  <span className="min-w-0 flex-1 truncate text-white/85">{w.name}</span>
                  <span className="num text-xl">{w.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {muted && (
          <div className="mt-4 flex items-center gap-2 text-xs text-white/40">
            <BellOff size={14} />
            {t('tv.soundOff')}
          </div>
        )}
      </aside>

      {locked && (
        <button onClick={() => void unlock()} className="fixed inset-0 z-50 grid place-items-center bg-ink/92 text-white">
          <span className="flex flex-col items-center gap-4 text-center px-6">
            <Volume2 size={56} />
            <span className="display text-4xl font-semibold">{t('tv.enableSound')}</span>
            <span className="max-w-md text-white/65">{t('tv.enableSound')}</span>
            <LanguageSwitcher className="text-white" />
          </span>
        </button>
      )}
    </div>
  )
}


function TvMedia({ urls, intervalSec }: { urls: string; intervalSec: number }) {
  const list = urls.split(/[\n,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u))
  const [i, setI] = useState(0)
  useEffect(() => {
    if (list.length <= 1) return
    const t = setInterval(() => setI((x) => (x + 1) % list.length), intervalSec * 1000)
    return () => clearInterval(t)
  }, [urls, intervalSec, list.length])
  const src = list[i] || list[0]
  if (!src) return null
  const isVideo = /\.(mp4|webm|ogg)(\?|$)/i.test(src)
  if (isVideo) return <video key={src} src={src} className="h-full w-full object-cover" autoPlay muted loop playsInline />
  return <img key={src} src={src} alt="" className="h-full w-full object-cover" />
}
