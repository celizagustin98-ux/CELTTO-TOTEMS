import { api, type Stats } from '../lib/api'
import { fmtMin, hhmm } from '../lib/format'
import { useLive, useLoad } from '../lib/live'
import { Button, Card, Empty, ErrorBox, Spinner, useToast } from '../ui'

interface Ov { date: string; sectors: (Stats & { id: number; name: string; color: string })[] }
interface TicketRow { id: number; code: string; status: string; sectorName: string; label: string; createdAt: string; calledAt: string | null; desk: string | null }
const STATUS: Record<string, { t: string; c: string }> = {
  waiting: { t: 'En espera', c: 'bg-amber-100 text-amber-900' }, called: { t: 'Llamado', c: 'bg-blue-100 text-blue-900' }, serving: { t: 'En atención', c: 'bg-indigo-100 text-indigo-900' },
  done: { t: 'Atendido', c: 'bg-emerald-100 text-emerald-900' }, absent: { t: 'Ausente', c: 'bg-zinc-200 text-zinc-700' }, cancelled: { t: 'Cancelado', c: 'bg-red-100 text-red-800' },
}

export default function Overview() {
  const toast = useToast()
  const ov = useLoad(() => api<Ov>('/api/admin/overview'))
  const tk = useLoad(() => api<TicketRow[]>('/api/admin/tickets'))
  useLive((m) => { if (m.type === 'queue' || m.type === 'config') { void ov.reload(); void tk.reload() } })
  const cancel = async (id: number) => {
    try { await api(`/api/admin/tickets/${id}/cancel`, { method: 'POST' }); toast('Turno cancelado') } catch (e) { toast((e as Error).message, 'error') }
  }
  if (ov.loading) return <Spinner />
  if (ov.error) return <ErrorBox msg={ov.error} retry={ov.reload} />
  const sectors = ov.data!.sectors
  return (
    <div className="space-y-6 fade-up">
      <header className="mb-2"><h1 className="display text-[1.65rem] font-semibold tracking-tight">Resumen de hoy</h1><p className="mt-1 text-[14px] text-muted">Se actualiza en vivo cuando cambia una cola.</p></header>
      {sectors.length === 0 ? <Empty title="Todavía no hay secretarías" hint="Creá la primera en “Secretarías y botones” para empezar a emitir turnos." /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sectors.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <div className="flex">
                <div className="w-3 shrink-0" style={{ background: s.color }} />
                <div className="flex-1 p-5">
                  <div className="display text-lg font-semibold">{s.name}</div>
                  <div className="mt-3 flex items-end gap-6">
                    <div><div className="num text-6xl leading-none">{s.waiting}</div><div className="mt-1 text-sm text-muted">en espera</div></div>
                    <div><div className="num text-3xl leading-none text-ink-soft">{s.active}</div><div className="mt-1 text-sm text-muted">en atención</div></div>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm">
                    <div><dt className="text-muted">Atendidos</dt><dd className="font-semibold">{s.done}</dd></div>
                    <div><dt className="text-muted">Ausentes</dt><dd className="font-semibold">{s.absent}</dd></div>
                    <div><dt className="text-muted">Espera prom.</dt><dd className="font-semibold">{fmtMin(s.avgWaitMin)}</dd></div>
                  </dl>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <section>
        <h2 className="display mb-3 text-xl font-semibold">Turnos de hoy</h2>
        {tk.data && tk.data.length === 0 ? <Empty title="Aún no se emitió ningún turno hoy" /> : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted"><tr><th className="px-4 py-3 font-medium">Turno</th><th className="px-4 py-3 font-medium">Secretaría</th><th className="px-4 py-3 font-medium">Botón</th><th className="px-4 py-3 font-medium">Emitido</th><th className="px-4 py-3 font-medium">Llamado</th><th className="px-4 py-3 font-medium">Estado</th><th /></tr></thead>
              <tbody>
                {tk.data?.slice(0, 60).map((t) => (
                  <tr key={t.id} className="border-b border-line/70 last:border-0">
                    <td className="num px-4 py-2.5 text-lg">{t.code}</td><td className="px-4 py-2.5">{t.sectorName}</td><td className="px-4 py-2.5 text-muted">{t.label}</td>
                    <td className="px-4 py-2.5">{hhmm(t.createdAt)}</td><td className="px-4 py-2.5">{hhmm(t.calledAt)}{t.desk ? ` · ${t.desk}` : ''}</td>
                    <td className="px-4 py-2.5"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[t.status]?.c}`}>{STATUS[t.status]?.t}</span></td>
                    <td className="px-4 py-2.5 text-right">{['waiting', 'called', 'serving'].includes(t.status) && <Button variant="ghost" size="sm" onClick={() => cancel(t.id)}>Cancelar</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  )
}
