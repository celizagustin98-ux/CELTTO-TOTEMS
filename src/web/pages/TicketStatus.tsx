import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { BellRing, CheckCircle2, Clock, Lock, MapPin, Users, Volume2, WifiOff, XCircle } from 'lucide-react'
import { api } from '../lib/api'
import { clock, textOn } from '../lib/format'
import { useDebounced, useLive } from '../lib/live'
import { LanguagePills } from '../components/LanguageSwitcher'
import { Logo } from '../components/Brand'

type Info = {
  code: string
  status: 'waiting' | 'called' | 'serving' | 'done' | 'absent' | 'cancelled'
  sectorName: string
  sectorColor: string
  desk: string | null
  buttonLabel: string | null
  waitingAhead: number
  estimatedWaitMin: number | null
  createdAt: string
  calledAt: string | null
  lastCalls: { code: string; desk: string | null; at: string }[]
  orgName: string
  brandColor: string
  logoVersion: string | null
}

/** Tono de aviso cuando llaman (necesita que el usuario haya tocado la pantalla alguna vez). */
function ring() {
  try {
    const c = new AudioContext()
    ;[0, 0.25, 0.5].forEach((d, i) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.frequency.value = [880, 1175, 1320][i]
      g.gain.setValueAtTime(0.0001, c.currentTime + d)
      g.gain.exponentialRampToValueAtTime(0.4, c.currentTime + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d + 0.4)
      o.connect(g).connect(c.destination)
      o.start(c.currentTime + d)
      o.stop(c.currentTime + d + 0.45)
    })
    setTimeout(() => void c.close(), 1500)
  } catch {
    /* sin audio */
  }
}

export default function TicketStatus() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState('')
  const [soundOn, setSoundOn] = useState(false)
  const initialAhead = useRef<number | null>(null)
  const prev = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<Info>(`/api/public/ticket/${encodeURIComponent(token)}`)
      if (initialAhead.current === null && d.status === 'waiting') initialAhead.current = Math.max(d.waitingAhead, 1)
      if (prev.current === 'waiting' && d.status === 'called') {
        navigator.vibrate?.([400, 150, 400, 150, 400])
        if (soundOn) ring()
      }
      prev.current = d.status
      setInfo(d)
      setErr('')
    } catch (e) {
      setErr((e as Error).message || t('ticket.notFound'))
    }
  }, [token, t, soundOn])
  const reloadSoon = useDebounced(load, 500)

  useEffect(() => {
    void load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])
  const connected = useLive((m) => {
    if (m.type === 'call' || m.type === 'queue') reloadSoon()
  })

  if (err && !info) {
    return (
      <div className="grid min-h-full place-items-center bg-night p-8 text-center text-white">
        <div>
          <XCircle size={44} className="mx-auto mb-3 text-white/50" />
          <div className="display text-2xl">{t('ticket.notFound')}</div>
          <p className="mt-2 text-white/60">{err}</p>
        </div>
      </div>
    )
  }
  if (!info) {
    return (
      <div className="grid min-h-full place-items-center bg-night">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      </div>
    )
  }

  const calling = info.status === 'called' || info.status === 'serving'
  const finished = ['done', 'absent', 'cancelled'].includes(info.status)
  const place = info.desk ? `${info.sectorName} · ${info.desk}` : info.sectorName
  const progress = info.status === 'waiting' && initialAhead.current ? Math.min(1, 1 - info.waitingAhead / (initialAhead.current + 1)) : calling || finished ? 1 : 0
  const color = info.sectorColor || info.brandColor

  return (
    <div className="relative min-h-full overflow-hidden bg-night px-5 pb-10 pt-5 text-white">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full blur-3xl" style={{ background: `${color}40` }} />
      <div className="relative mx-auto max-w-md">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo version={info.logoVersion} className="h-9 w-9" rounded="rounded-lg" />
            <div className="truncate text-sm font-medium text-white/80">{info.orgName}</div>
          </div>
          <LanguagePills className="scale-90" />
        </header>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-white/45"><Lock size={12} /> Panel privado de tu turno</div>

        <motion.div layout className="mt-4 overflow-hidden rounded-[1.75rem] shadow-2xl ring-1 ring-white/10" style={{ background: `linear-gradient(150deg, ${color}, color-mix(in srgb, ${color} 60%, #0b1220))`, color: textOn(color) }}>
          <div className="px-6 pb-6 pt-5 text-center">
            <div className="text-[12px] font-semibold uppercase tracking-[0.2em] opacity-80">{t('ticket.yours')}</div>
            <div className="num mt-1 text-[5.5rem] leading-none">{info.code}</div>
            <div className="mt-1 text-[15px] opacity-90">{info.buttonLabel ? `${info.buttonLabel} · ` : ''}{info.sectorName}</div>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-[13px] font-medium">
              {calling ? <BellRing size={14} className="pulse-dot" /> : finished ? <CheckCircle2 size={14} /> : <Clock size={14} />}
              {t(`ticket.status.${info.status}`)}
            </div>
          </div>
          <div className="h-1.5 bg-black/20"><motion.div className="h-full bg-white/90" initial={false} animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ duration: 0.8 }} /></div>
        </motion.div>

        <AnimatePresence mode="wait">
          {calling ? (
            <motion.div key="call" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="glow-pulse mt-5 rounded-3xl bg-white p-6 text-center text-night" style={{ ['--glow' as string]: color }}>
              <BellRing size={30} className="mx-auto" style={{ color }} />
              <div className="display mt-2 text-2xl font-semibold">{info.status === 'serving' ? 'Te están atendiendo' : '¡Es tu turno!'}</div>
              <div className="mt-3 text-sm text-slate-500">{t('tv.goTo')}</div>
              <div className="mt-1 flex items-center justify-center gap-2 text-3xl font-bold"><MapPin size={26} style={{ color }} /> {place}</div>
              {info.calledAt && <div className="mt-2 text-xs text-slate-400">Llamado a las {clock(new Date(info.calledAt))}</div>}
            </motion.div>
          ) : info.status === 'waiting' ? (
            <motion.div key="wait" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/[0.07] p-4 text-center ring-1 ring-white/10">
                <Users size={20} className="mx-auto mb-1 text-white/50" />
                <div className="num text-5xl">{info.waitingAhead}</div>
                <div className="text-sm text-white/60">{info.waitingAhead === 1 ? 'turno antes que el tuyo' : 'turnos antes que el tuyo'}</div>
              </div>
              <div className="rounded-2xl bg-white/[0.07] p-4 text-center ring-1 ring-white/10">
                <Clock size={20} className="mx-auto mb-1 text-white/50" />
                <div className="num text-5xl">{info.estimatedWaitMin != null ? `~${info.estimatedWaitMin}` : '—'}</div>
                <div className="text-sm text-white/60">minutos estimados</div>
              </div>
              <div className="col-span-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-center text-[13.5px] text-white/70 ring-1 ring-white/10">
                Cuando te llamen, esta pantalla te avisa y te dice a qué box ir. Podés esperar cerca de la sala.
              </div>
            </motion.div>
          ) : (
            <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 rounded-2xl bg-white/[0.07] p-5 text-center text-white/80 ring-1 ring-white/10">
              {info.status === 'done' ? 'Tu atención finalizó. ¡Gracias!' : info.status === 'absent' ? 'Te llamaron y no te presentaste. Acercate a la secretaría si necesitás atención.' : 'Este turno fue cancelado.'}
            </motion.div>
          )}
        </AnimatePresence>

        {info.lastCalls.length > 0 && !finished && (
          <div className="mt-5">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/45">Últimos llamados en {info.sectorName}</div>
            <ul className="space-y-1.5">
              {info.lastCalls.map((c) => (
                <li key={c.code + c.at} className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${c.code === info.code ? 'bg-white text-night' : 'bg-white/[0.05]'}`}>
                  <span className="num text-xl">{c.code}</span>
                  <span className="text-[13px] opacity-75">{c.desk ?? ''} · {clock(new Date(c.at))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!finished && !soundOn && (
          <button onClick={() => { setSoundOn(true); ring() }} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 py-3 text-[14px] ring-1 ring-white/15 active:scale-[0.98]">
            <Volume2 size={17} /> Activar aviso sonoro cuando me llamen
          </button>
        )}

        <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-white/40">
          {!connected && <WifiOff size={13} />}
          {t('ticket.autoRefresh')}
        </p>
      </div>
    </div>
  )
}
