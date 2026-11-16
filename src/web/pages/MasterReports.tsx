import { useState } from 'react'
import { Download } from 'lucide-react'
import { api, type Stats } from '../lib/api'
import { fmtMin, todayStr } from '../lib/format'
import { useLoad } from '../lib/live'
import { Button, Card, Empty, ErrorBox, Field, Spinner, inputCls } from '../ui'

interface Rep { from: string; to: string; totals: Stats; bySector: (Stats & { id: number; name: string; color: string })[]; byDay: (Stats & { date: string })[] }

export default function Reports() {
  const [from, setFrom] = useState(() => todayStr(new Date(Date.now() - 6 * 86400000)))
  const [to, setTo] = useState(() => todayStr())
  const { data, error, loading } = useLoad(() => api<Rep>(`/api/admin/reports?from=${from}&to=${to}`), [from, to])

  const csv = () => {
    if (!data) return
    const head = 'Fecha,Emitidos,Atendidos,Ausentes,Cancelados,Espera promedio (min),Atención promedio (min)'
    const rows = data.byDay.map((d) => [d.date, d.total, d.done, d.absent, d.cancelled, d.avgWaitMin ?? '', d.avgServiceMin ?? ''].join(','))
    const url = URL.createObjectURL(new Blob(['\ufeff' + [head, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }))
    Object.assign(document.createElement('a'), { href: url, download: `reporte-${from}_${to}.csv` }).click()
    URL.revokeObjectURL(url)
  }
  const Tile = ({ label, v }: { label: string; v: string | number }) => <Card className="p-4"><div className="num text-4xl leading-none">{v}</div><div className="mt-1.5 text-sm text-muted">{label}</div></Card>

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="display text-3xl font-semibold">Reportes</h1><p className="text-sm text-muted">Turnos emitidos y tiempos por secretaría. Máximo 92 días.</p></div>
        <div className="flex items-end gap-3">
          <Field label="Desde"><input type="date" className={inputCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button variant="soft" onClick={csv} disabled={!data?.byDay.length}><Download size={17} />CSV</Button>
        </div>
      </header>
      {loading ? <Spinner /> : error ? <ErrorBox msg={error} /> : data!.totals.total === 0 ? <Empty title="No hay turnos en este período" hint="Probá con otro rango de fechas." /> : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Tile label="Turnos emitidos" v={data!.totals.total} /><Tile label="Atendidos" v={data!.totals.done} /><Tile label="Ausentes" v={data!.totals.absent} />
            <Tile label="Espera promedio" v={fmtMin(data!.totals.avgWaitMin)} /><Tile label="Atención promedio" v={fmtMin(data!.totals.avgServiceMin)} />
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted"><tr>{['Secretaría', 'Emitidos', 'Atendidos', 'Ausentes', 'Cancelados', 'Espera prom.', 'Atención prom.'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>{data!.bySector.map((s) => <tr key={s.id} className="border-b border-line/70 last:border-0"><td className="px-4 py-3"><span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: s.color }} /><span className="font-medium">{s.name}</span></td><td className="px-4 py-3">{s.total}</td><td className="px-4 py-3">{s.done}</td><td className="px-4 py-3">{s.absent}</td><td className="px-4 py-3">{s.cancelled}</td><td className="px-4 py-3">{fmtMin(s.avgWaitMin)}</td><td className="px-4 py-3">{fmtMin(s.avgServiceMin)}</td></tr>)}</tbody>
            </table>
          </Card>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted"><tr>{['Día', 'Emitidos', 'Atendidos', 'Ausentes', 'Espera prom.'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>{data!.byDay.map((d) => <tr key={d.date} className="border-b border-line/70 last:border-0"><td className="px-4 py-3 font-medium">{new Date(d.date + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })}</td><td className="px-4 py-3">{d.total}</td><td className="px-4 py-3">{d.done}</td><td className="px-4 py-3">{d.absent}</td><td className="px-4 py-3">{fmtMin(d.avgWaitMin)}</td></tr>)}</tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
