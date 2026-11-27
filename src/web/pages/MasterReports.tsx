import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { fmtMin, hhmm, todayStr } from '../lib/format'
import { BarChart, HBars, Kpi } from '../components/Charts'
import { Button, Card, ErrorBox, Field, PageHeader, Spinner, inputCls } from '../ui'
import { STATUS } from './MasterOverview'

type Stats = {
  from: string
  to: string
  total: number
  ticketCount: number
  byStatus: Record<string, number>
  byHour: { hour: string; count: number }[]
  byDay: { date: string; count: number }[]
  byPrefix: { prefix: string; count: number }[]
  sectors: { sectorId: number; name: string; color: string; total: number; done: number; absent: number; avgWaitMin: number | null; avgServiceMin: number | null }[]
  avgWaitMin: number | null
  avgServiceMin: number | null
  maxWaitMin: number
  tickets: { id: number; date: string; code: string; status: string; sectorName: string; buttonLabel: string; desk: string | null; createdAt: string; calledAt: string | null; waitMin: number | null; serviceMin: number | null }[]
}

const shift = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return todayStr(d)
}
const PRESETS = [
  { l: 'Hoy', f: () => [todayStr(), todayStr()] },
  { l: 'Últimos 7 días', f: () => [shift(6), todayStr()] },
  { l: 'Últimos 30 días', f: () => [shift(29), todayStr()] },
  { l: 'Este mes', f: () => { const d = new Date(); return [todayStr(new Date(d.getFullYear(), d.getMonth(), 1)), todayStr()] } },
]

export default function Reports() {
  // Fecha local (antes usaba la fecha UTC: a la noche mostraba "mañana")
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())
  const [data, setData] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async (f = from, t = to) => {
    setLoading(true)
    setErr('')
    try {
      setData(await api<Stats>(`/api/admin/stats?from=${f}&to=${t}`))
    } catch (e) {
      setErr((e as Error).message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const done = data?.byStatus.done ?? 0
  const absent = data?.byStatus.absent ?? 0
  const absentRate = data && done + absent > 0 ? Math.round((absent / (done + absent)) * 100) : null

  return (
    <div className="fade-up space-y-6">
      <PageHeader title="Estadísticas" description="Turnos, tiempos de espera y de atención por período." />
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p.l} size="sm" variant="soft" onClick={() => { const [f, t] = p.f(); setFrom(f); setTo(t); void load(f, t) }}>{p.l}</Button>
            ))}
          </div>
          <span className="flex-1" />
          <Field label="Desde"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} /></Field>
          <Field label="Hasta"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputCls} /></Field>
          <Button onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} />Actualizar</Button>
          <a href={`/api/admin/stats/export.csv?from=${from}&to=${to}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[14px] font-medium hover:bg-paper">
            <Download size={15} /> Exportar CSV
          </a>
        </div>
      </Card>
      {err && <ErrorBox msg={err} retry={() => void load()} />}
      {!data && loading && <Spinner />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi label="Turnos" value={data.total} />
            <Kpi label="Espera promedio" value={fmtMin(data.avgWaitMin)} />
            <Kpi label="Atención promedio" value={fmtMin(data.avgServiceMin)} />
            <Kpi label="Espera máxima" value={fmtMin(data.maxWaitMin)} tone={data.maxWaitMin >= 30 ? 'danger' : data.maxWaitMin >= 15 ? 'warn' : undefined} />
            <Kpi label="Ausentismo" value={absentRate != null ? `${absentRate}%` : '—'} sub={`${absent} ausentes`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-4 font-semibold">Turnos por hora del día</h3>
              <BarChart data={data.byHour.map((h) => ({ label: `${h.hour}h`, value: h.count }))} />
            </Card>
            <Card className="p-5">
              <h3 className="mb-4 font-semibold">{data.byDay.length > 1 ? 'Turnos por día' : 'Por estado'}</h3>
              {data.byDay.length > 1 ? (
                <BarChart data={data.byDay.map((d) => ({ label: d.date.slice(5).split('-').reverse().join('/'), value: d.count }))} color="#2f6fed" />
              ) : (
                <HBars data={Object.entries(data.byStatus).map(([k, v]) => ({ label: STATUS[k]?.t ?? k, value: v }))} />
              )}
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="mb-4 font-semibold">Por secretaría</h3>
            <div className="overflow-x-auto">
              <table className="table-pro">
                <thead><tr><th>Secretaría</th><th>Total</th><th>Atendidos</th><th>Ausentes</th><th>Espera prom.</th><th>Atención prom.</th></tr></thead>
                <tbody>
                  {data.sectors.map((s) => (
                    <tr key={s.sectorId}>
                      <td><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</td>
                      <td className="tabular-nums">{s.total}</td>
                      <td className="tabular-nums">{s.done}</td>
                      <td className="tabular-nums">{s.absent}</td>
                      <td>{fmtMin(s.avgWaitMin)}</td>
                      <td>{fmtMin(s.avgServiceMin)}</td>
                    </tr>
                  ))}
                  {data.sectors.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Sin turnos en el período.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 font-semibold">Detalle de turnos</h3>
            <p className="mb-3 text-xs text-muted">{data.ticketCount > data.tickets.length ? `Se muestran los últimos ${data.tickets.length} de ${data.ticketCount}. El CSV trae todos.` : `${data.ticketCount} turnos.`}</p>
            <div className="max-h-[28rem] overflow-auto">
              <table className="table-pro">
                <thead className="sticky top-0 bg-surface"><tr><th>Fecha</th><th>Turno</th><th>Estado</th><th>Secretaría</th><th>Botón</th><th>Emitido</th><th>Espera</th><th>Atención</th></tr></thead>
                <tbody>
                  {data.tickets.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-muted">{t.date.split('-').reverse().join('/')}</td>
                      <td className="num">{t.code}</td>
                      <td><span className={`badge ${STATUS[t.status]?.c}`}>{STATUS[t.status]?.t ?? t.status}</span></td>
                      <td>{t.sectorName}</td>
                      <td className="text-muted">{t.buttonLabel}</td>
                      <td>{hhmm(t.createdAt)}</td>
                      <td>{fmtMin(t.waitMin)}</td>
                      <td>{fmtMin(t.serviceMin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
