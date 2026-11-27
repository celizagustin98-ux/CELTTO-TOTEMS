import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { BellRing, Clock, Users, WifiOff } from 'lucide-react'
import { api } from '../lib/api'
import { textOn } from '../lib/format'
import { useDebounced, useLive } from '../lib/live'
import { LanguagePills } from '../components/LanguageSwitcher'

type Info = {
  code: string
  status: 'waiting' | 'called' | 'serving' | 'done' | 'absent' | 'cancelled'
  sectorId: number
  sectorName: string
  sectorColor: string
  desk: string | null
  buttonLabel: string | null
  waitingAhead: number
  estimatedWaitMin: number | null
  orgName: string
}

export default function TicketStatus() {
  const { t } = useTranslation()
  const { code = '' } = useParams()
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState('')
  const prevStatus = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await api<Info>(`/api/public/ticket/${encodeURIComponent(code)}`)
      // Aviso con vibración cuando pasa de "en espera" a "llamado"
      if (prevStatus.current === 'waiting' && d.status === 'called') navigator.vibrate?.([300, 150, 300])
      prevStatus.current = d.status
      setInfo(d)
      setErr('')
    } catch (e) {
      setErr((e as Error).message || t('ticket.notFound'))
    }
  }, [code, t])
  const reloadSoon = useDebounced(load, 500)

  useEffect(() => {
    void load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  // Solo recarga si el evento es de su secretaría (antes recargaba con cualquier mensaje de cualquier sector)
  const connected = useLive((m) => {
    const sid = info?.sectorId
    if (m.type === 'call' && (m.ticket.code === info?.code || m.ticket.sectorId === sid)) reloadSoon()
    else if (m.type === 'queue' && (!sid || !m.sectorIds?.length || m.sectorIds.includes(sid))) reloadSoon()
  })

  if (err && !info) {
    return (
      <div className="grid min-h-full place-items-center bg-night p-8 text-center text-white">
        <div>
          <div className="display text-3xl">{t('ticket.yours')}</div>
          <p className="mt-2 text-white/70">{err}</p>
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
  const place = info.desk ? `${info.sectorName} · ${info.desk}` : info.sectorName
  const message = calling ? t('ticket.goTo', { place }) : info.status === 'waiting' ? t('ticket.waitCall') : t('ticket.finished')

  return (
    <div className="min-h-full bg-night px-5 py-6 text-white sm:p-10">
      <div className="mx-auto flex max-w-lg items-center justify-between">
        <div className="truncate text-sm font-medium uppercase tracking-[0.16em] text-white/50">{info.orgName}</div>
        <LanguagePills className="scale-90" />
      </div>
      <motion.div key={info.status + info.waitingAhead} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-8 max-w-lg text-center">
        <div className="text-sm uppercase tracking-[0.2em] text-white/50">{t('ticket.yours')}</div>
        <div className="num mt-2 text-7xl" style={{ color: info.sectorColor }}>
          {info.code}
        </div>
        <div className="mt-2 text-lg text-white/80">{info.buttonLabel ? `${info.buttonLabel} · ` : ''}{info.sectorName}</div>
        <div className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-sm">{t(`ticket.status.${info.status}`)}</div>

        <div
          className={`mt-8 flex items-center justify-center gap-3 rounded-3xl px-6 py-8 text-2xl font-semibold ${calling ? 'shadow-2xl' : ''}`}
          style={calling ? { background: info.sectorColor, color: textOn(info.sectorColor) } : { background: 'rgba(255,255,255,0.07)' }}
        >
          {calling && <BellRing className="pulse-dot shrink-0" size={28} />}
          {message}
        </div>

        {info.status === 'waiting' && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/[0.06] p-4">
              <Users size={20} className="mx-auto mb-1 text-white/50" />
              <div className="num text-4xl">{info.waitingAhead}</div>
              <div className="text-sm text-white/60">{t('ticket.ahead')}</div>
            </div>
            <div className="rounded-2xl bg-white/[0.06] p-4">
              <Clock size={20} className="mx-auto mb-1 text-white/50" />
              <div className="num text-4xl">{info.estimatedWaitMin != null ? `~${info.estimatedWaitMin}` : '—'}</div>
              <div className="text-sm text-white/60">{t('ticket.estimated')} (min)</div>
            </div>
          </div>
        )}
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-white/45">
          {!connected && <WifiOff size={14} />}
          {t('ticket.autoRefresh')}
        </p>
      </motion.div>
    </div>
  )
}
