import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { useLive } from '../lib/live'

type Info = {
  code: string
  status: string
  sectorName: string
  sectorColor: string
  desk: string | null
  waitingAhead: number
  estimatedWaitMin: number | null
  place: string
  message: string
}

export default function TicketStatus() {
  const { code = '' } = useParams()
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      setInfo(await api<Info>(`/api/public/ticket/${encodeURIComponent(code)}`))
      setErr('')
    } catch (e: any) {
      setErr(e.message || 'No encontrado')
    }
  }, [code])

  useEffect(() => {
    void load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  useLive(() => {
    void load()
  })

  if (err) {
    return (
      <div className="grid min-h-full place-items-center bg-ink p-8 text-center text-white">
        <div>
          <div className="display text-3xl">Turno</div>
          <p className="mt-2 text-white/70">{err}</p>
        </div>
      </div>
    )
  }
  if (!info) {
    return (
      <div className="grid min-h-full place-items-center bg-ink">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      </div>
    )
  }

  const calling = info.status === 'called' || info.status === 'serving'

  return (
    <div className="min-h-full bg-ink p-6 text-white sm:p-10">
      <motion.div
        key={info.status + info.waitingAhead}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-lg text-center"
      >
        <div className="text-sm uppercase tracking-widest text-white/50">Tu turno</div>
        <div className="num mt-2 text-6xl font-bold" style={{ color: info.sectorColor }}>
          {info.code}
        </div>
        <div className="mt-2 text-lg text-white/80">{info.sectorName}</div>
        <div
          className="mt-8 rounded-2xl px-6 py-8 text-xl font-semibold"
          style={{ background: calling ? info.sectorColor : 'rgba(255,255,255,0.08)' }}
        >
          {info.message}
        </div>
        {info.status === 'waiting' && (
          <div className="mt-6 space-y-2 text-white/80">
            <p>
              Personas antes: <strong className="text-white">{info.waitingAhead}</strong>
            </p>
            {info.estimatedWaitMin != null && (
              <p>
                Espera estimada: <strong className="text-white">~{info.estimatedWaitMin} min</strong>
              </p>
            )}
            <p className="text-sm text-white/50">Esta pantalla se actualiza sola. No hace falta recargar.</p>
          </div>
        )}
        {calling && info.desk && <p className="mt-4 text-2xl">Box / escritorio: {info.desk}</p>}
      </motion.div>
    </div>
  )
}
