import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Download, Gauge, Trophy, UserCheck, UserX } from 'lucide-react'
import { api } from '../lib/api'
import { fmtMin } from '../lib/format'
import { Avatar, ErrorBox, Skeleton, StatCard } from '../ui'
import { BarChart } from './Charts'

type Prod = {
  totals: { issued: number; done: number; absent: number; cancelled: number; transferred: number; avgWaitMin: number | null; maxWaitMin: number; avgServiceMin: number | null; attendRate: number | null }
  users: { userId: number; name: string; active: boolean; sectors: string[]; days: number; called: number; done: number; absent: number; transferred: number; recalls: number; avgServiceMin: number | null; avgWaitMin: number | null; activeHours: number; perHour: number | null; absentRate: number | null }[]
  sectors: { sectorId: number; name: string; color: string; issued: number; done: number; absent: number; cancelled: number; transferred: number; avgWaitMin: number | null; maxWaitMin: number; avgServiceMin: number | null; attendRate: number | null }[]
  days: { date: string; issued: number; done: number; absent: number; avgWaitMin: number | null; avgServiceMin: number | null }[]
  heatmap: number[][]
}
const WEEK = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function useProductivity(from: string, to: string) {
  const [data, setData] = useState<Prod | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    setData(null)
    api<Prod>(`/api/admin/productivity?from=${from}&to=${to}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr((e as Error).message))
    return () => { alive = false }
  }, [from, to])
  return { data, err }
}

export function ProductivityTab({ from, to, canExport }: { from: string; to: string; canExport: boolean }) {
  const { data, err } = useProductivity(from, to)
  if (err) return <ErrorBox msg={err} />
  if (!data) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
  const t = data.totals
  const best = data.users[0]
  const maxDone = Math.max(1, ...data.users.map((u) => u.done))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Atendidos" value={t.done} icon={<UserCheck size={16} />} tone="ok" hint={t.attendRate != null ? `${t.attendRate}% de los turnos emitidos` : undefined} />
        <StatCard label="Ausentes" value={t.absent} icon={<UserX size={16} />} tone={t.absent > t.done * 0.15 ? 'warn' : 'brand'} hint={`${t.transferred} derivados · ${t.cancelled} cancelados`} />
        <StatCard label="Atención promedio" value={t.avgServiceMin ?? 0} icon={<Clock size={16} />} format={(n) => (t.avgServiceMin == null ? '—' : `${n.toFixed(1)} min`)} hint="Desde que inicia hasta que finaliza" />
        <StatCard label="Espera promedio" value={t.avgWaitMin ?? 0} icon={<Gauge size={16} />} format={(n) => (t.avgWaitMin == null ? '—' : `${n.toFixed(1)} min`)} hint={`Máxima: ${fmtMin(t.maxWaitMin)}`} />
      </div>

      <div className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h3 className="font-semibold">Productividad por usuario</h3>
            <p className="text-[12.5px] text-muted">Horas activas = desde el primer llamado hasta la última atención de cada día.</p>
          </div>
          {canExport && (
            <a href={`/api/admin/productivity/export.csv?from=${from}&to=${to}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-paper">
              <Download size={14} /> Exportar CSV
            </a>
          )}
        </div>
        {data.users.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No hay atenciones en el período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-pro">
              <thead><tr><th>Usuario</th><th>Atendidos</th><th>Por hora</th><th>Atención prom.</th><th>Espera de sus turnos</th><th>Ausentes</th><th>Derivados</th><th>Horas activas</th></tr></thead>
              <tbody>
                {data.users.map((u, i) => (
                  <motion.tr key={u.userId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium">{u.name}{best?.userId === u.userId && u.done > 0 && <Trophy size={13} className="text-warn" />}</div>
                          <div className="truncate text-[12px] text-muted">{u.sectors.join(', ')} · {u.days} {u.days === 1 ? 'día' : 'días'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="num w-8 text-lg">{u.done}</span>
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-brand" style={{ width: `${(u.done / maxDone) * 100}%` }} /></div>
                      </div>
                    </td>
                    <td className="tabular-nums">{u.perHour ?? '—'}</td>
                    <td>{fmtMin(u.avgServiceMin)}</td>
                    <td>{fmtMin(u.avgWaitMin)}</td>
                    <td><span className={u.absentRate != null && u.absentRate > 15 ? 'text-warn' : ''}>{u.absent}{u.absentRate != null ? <span className="text-[12px] text-muted"> ({u.absentRate}%)</span> : null}</span></td>
                    <td className="tabular-nums">{u.transferred}</td>
                    <td className="tabular-nums">{u.activeHours} h</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <h3 className="mb-3 font-semibold">Por secretaría</h3>
          <div className="space-y-3">
            {data.sectors.map((s) => (
              <div key={s.sectorId}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>
                  <span className="text-muted">{s.done}/{s.issued} atendidos · espera {fmtMin(s.avgWaitMin)} · atención {fmtMin(s.avgServiceMin)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full" style={{ width: `${s.attendRate ?? 0}%`, background: s.color }} /></div>
              </div>
            ))}
            {data.sectors.length === 0 && <p className="text-sm text-muted">Sin datos.</p>}
          </div>
        </div>
        <div className="surface p-5">
          <h3 className="mb-3 font-semibold">Evolución diaria (atendidos)</h3>
          <BarChart data={data.days.map((d) => ({ label: d.date.slice(5).split('-').reverse().join('/'), value: d.done }))} height={170} />
        </div>
      </div>
    </div>
  )
}

/** Mapa de calor: cuántos turnos se emiten por día de la semana y hora (para planificar personal). */
export function HeatmapTab({ from, to }: { from: string; to: string }) {
  const { data, err } = useProductivity(from, to)
  if (err) return <ErrorBox msg={err} />
  if (!data) return <Skeleton className="h-80" />
  const max = Math.max(1, ...data.heatmap.flat())
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => h >= 6 && h <= 22)
  const order = [1, 2, 3, 4, 5, 6, 0]
  const peak = order.flatMap((d) => hours.map((h) => ({ d, h, v: data.heatmap[d][h] }))).sort((a, b) => b.v - a.v)[0]
  return (
    <div className="surface p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">Mapa de demanda</h3>
          <p className="text-[12.5px] text-muted">Turnos emitidos por día de la semana y hora. Sirve para decidir cuántos puestos abrir en cada franja.</p>
        </div>
        {peak && peak.v > 0 && <span className="badge badge-warn">Pico: {WEEK[peak.d]} {peak.h}–{peak.h + 1} h ({peak.v} turnos)</span>}
      </div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `3rem repeat(${hours.length}, minmax(2rem, 1fr))` }}>
          <span />
          {hours.map((h) => <span key={h} className="text-center text-[10.5px] text-muted">{h}h</span>)}
          {order.map((d) => (
            <div key={d} className="contents">
              <span className="flex items-center text-[12px] font-medium text-muted">{WEEK[d]}</span>
              {hours.map((h) => {
                const v = data.heatmap[d][h]
                const k = v / max
                return (
                  <motion.span
                    key={h}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: (d * 17 + h) * 0.002 }}
                    title={`${WEEK[d]} ${h}:00 — ${v} turnos`}
                    className="grid h-8 place-items-center rounded-md text-[10.5px] font-medium"
                    style={{ background: v ? `color-mix(in srgb, var(--color-brand) ${Math.round(12 + k * 88)}%, transparent)` : 'var(--color-paper)', color: k > 0.55 ? '#fff' : 'var(--color-muted)' }}
                  >
                    {v || ''}
                  </motion.span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
