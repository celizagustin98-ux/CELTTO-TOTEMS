import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Button, Card, Field, inputCls } from '../ui'

type Stats = {
  from: string
  to: string
  total: number
  byStatus: Record<string, number>
  byHour: { hour: string; count: number }[]
  byDay: { date: string; count: number }[]
  byPrefix: { prefix: string; count: number }[]
  sectors: {
    sectorId: number
    name: string
    color: string
    total: number
    done: number
    absent: number
    avgWaitMin: number | null
    avgServiceMin: number | null
  }[]
  avgWaitMin: number | null
  avgServiceMin: number | null
  maxWaitMin: number
  tickets: any[]
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function Reports() {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [data, setData] = useState<Stats | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setErr('')
    try {
      setData(await api<Stats>(`/api/admin/stats?from=${from}&to=${to}`))
    } catch (e: any) {
      setErr(e.message || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const maxHour = Math.max(1, ...(data?.byHour.map((h) => h.count) || [1]))

  return (
    <div className="space-y-4">
      <header><h1 className="display text-2xl font-semibold">Estadísticas y reportes</h1><p className="text-sm text-muted">Análisis de turnos por rango de fechas</p></header>
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Desde">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </Field>
          <Button onClick={() => void load()} disabled={loading}>
            {loading ? 'Cargando…' : 'Actualizar'}
          </Button>
          <a className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-sm font-medium" href={`/api/admin/stats/export.csv?from=${from}&to=${to}`}>
            Exportar CSV
          </a>
        </div>
        {err && <p className="text-red-600 mt-2">{err}</p>}
      </Card>

      {data && (
        <>
          <div className="grid md:grid-cols-4 gap-3">
            <Card>
              <div className="text-sm text-slate-500">Total turnos</div>
              <div className="text-3xl font-bold">{data.total}</div>
            </Card>
            <Card>
              <div className="text-sm text-slate-500">Espera promedio</div>
              <div className="text-3xl font-bold">{data.avgWaitMin ?? '—'} <span className="text-base font-normal">min</span></div>
            </Card>
            <Card>
              <div className="text-sm text-slate-500">Atención promedio</div>
              <div className="text-3xl font-bold">{data.avgServiceMin ?? '—'} <span className="text-base font-normal">min</span></div>
            </Card>
            <Card>
              <div className="text-sm text-slate-500">Espera máxima</div>
              <div className="text-3xl font-bold">{data.maxWaitMin || 0} <span className="text-base font-normal">min</span></div>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <Card>
              <h3 className="font-semibold mb-3">Por estado</h3>
              <div className="space-y-2">
                {Object.entries(data.byStatus).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="capitalize">{k}</span>
                    <span className="font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="font-semibold mb-3">Por prefijo</h3>
              <div className="space-y-2">
                {data.byPrefix.map((p) => (
                  <div key={p.prefix} className="flex justify-between text-sm">
                    <span>{p.prefix}</span>
                    <span className="font-semibold">{p.count}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card>
            <h3 className="font-semibold mb-3">Por hora del día</h3>
            <div className="flex items-end gap-1 h-40">
              {data.byHour.map((h) => (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-blue-600/80 rounded-t" style={{ height: `${(h.count / maxHour) * 100}%`, minHeight: h.count ? 4 : 0 }} title={`${h.count}`} />
                  <span className="text-[10px] text-slate-500">{h.hour}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="font-semibold mb-3">Por secretaría</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b">
                    <th className="py-2">Secretaría</th>
                    <th>Total</th>
                    <th>Finalizados</th>
                    <th>Ausentes</th>
                    <th>Espera prom.</th>
                    <th>Atención prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sectors.map((s) => (
                    <tr key={s.sectorId} className="border-b border-slate-100">
                      <td className="py-2">
                        <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: s.color }} />
                        {s.name}
                      </td>
                      <td>{s.total}</td>
                      <td>{s.done}</td>
                      <td>{s.absent}</td>
                      <td>{s.avgWaitMin ?? '—'} min</td>
                      <td>{s.avgServiceMin ?? '—'} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h3 className="font-semibold mb-3">Detalle de turnos ({data.tickets.length})</h3>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-slate-500 border-b">
                    <th className="py-2">Fecha</th>
                    <th>Código</th>
                    <th>Estado</th>
                    <th>Secretaría</th>
                    <th>Botón</th>
                    <th>Espera</th>
                    <th>Atención</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tickets.slice(0, 300).map((t) => (
                    <tr key={t.id} className="border-b border-slate-50">
                      <td className="py-1.5">{t.date}</td>
                      <td className="font-mono font-semibold">{t.code}</td>
                      <td>{t.status}</td>
                      <td>{t.sectorName}</td>
                      <td>{t.buttonLabel}</td>
                      <td>{t.waitMin ?? '—'}</td>
                      <td>{t.serviceMin ?? '—'}</td>
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
