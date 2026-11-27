import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Circle, KeyRound, Layers, Monitor, MonitorOff, Users, Rocket, Moon } from 'lucide-react'
import { api, type Stats } from '../lib/api'
import { fmtMin, hhmm } from '../lib/format'
import { useDebounced, useLive, useLoad } from '../lib/live'
import { MANAGERS, useAuth } from '../auth'
import { Kpi } from '../components/Charts'
import { Button, Card, Empty, ErrorBox, PageHeader, Spinner, useConfirm, useToast } from '../ui'

interface Ov { date: string; sectors: (Stats & { id: number; name: string; color: string })[] }
interface TicketRow { id: number; code: string; status: string; sectorName: string; sectorColor: string; label: string; createdAt: string; calledAt: string | null; desk: string | null; dni: string | null }
type Alert = { type: 'queue_high'; sectorName: string; waiting: number; threshold: number } | { type: 'station_stale'; name: string; kind: string; lastSeenAt: string } | { type: 'default_pin' }

export const STATUS: Record<string, { t: string; c: string }> = {
  waiting: { t: 'En espera', c: 'badge-warn' },
  called: { t: 'Llamado', c: 'badge-brand' },
  serving: { t: 'En atención', c: 'badge-brand' },
  done: { t: 'Atendido', c: 'badge-ok' },
  absent: { t: 'Ausente', c: 'badge-muted' },
  cancelled: { t: 'Cancelado', c: 'badge-danger' },
}

export default function Overview() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const canEdit = !!user && MANAGERS.includes(user.role)
  const ov = useLoad(() => api<Ov>('/api/admin/overview'))
  const tk = useLoad(() => api<TicketRow[]>('/api/admin/tickets'))
  const al = useLoad(() => api<{ alerts: Alert[] }>('/api/admin/ops-alerts'))
  const setup = useLoad(() =>
    Promise.all([api<unknown[]>('/api/admin/stations'), canEdit ? api<{ role: string }[]>('/api/admin/users') : Promise.resolve(null)]).then(([st, us]) => ({ stations: st.length, users: us ? us.filter((u) => u.role === 'secretary').length : 1 })),
  )
  const reload = useDebounced(() => {
    void ov.reload()
    void tk.reload()
    void al.reload()
  }, 400)
  useLive((m) => {
    if (m.type === 'queue' || m.type === 'config') reload()
  })
  const cancel = async (t: TicketRow) => {
    if (!(await confirm({ title: 'Cancelar turno', message: <>¿Cancelar el turno <b>{t.code}</b>? Sale de la cola y no se puede deshacer.</>, confirmLabel: 'Cancelar turno', danger: true }))) return
    try {
      await api(`/api/admin/tickets/${t.id}/cancel`, { method: 'POST' })
      toast('Turno cancelado')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const closeDay = async () => {
    if (!(await confirm({ title: 'Cerrar el día', message: 'Se cancelan los turnos que quedaron en espera o en atención y se guarda el resumen del día. Hacelo al terminar la jornada.', confirmLabel: 'Cerrar el día', danger: true }))) return
    try {
      await api('/api/admin/day-close', { body: {} })
      toast('Día cerrado')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (ov.loading) return <Spinner />
  if (ov.error) return <ErrorBox msg={ov.error} retry={ov.reload} />
  const sectors = ov.data!.sectors
  const tot = sectors.reduce((a, s) => ({ waiting: a.waiting + s.waiting, active: a.active + s.active, done: a.done + s.done, absent: a.absent + s.absent, total: a.total + s.total }), { waiting: 0, active: 0, done: 0, absent: 0, total: 0 })
  const waits = sectors.map((s) => s.avgWaitMin).filter((x): x is number => x != null)
  const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null
  const oldest = Math.max(0, ...sectors.map((s) => s.oldestWaitingMin))
  const alerts = al.data?.alerts ?? []

  const steps = [
    { done: sectors.length > 0, label: 'Crear una secretaría con sus botones', to: '/master/secretarias', icon: Layers },
    { done: (setup.data?.users ?? 0) > 0, label: 'Crear los usuarios de secretaría', to: '/master/usuarios', icon: Users },
    { done: (setup.data?.stations ?? 0) > 0, label: 'Generar la URL del tótem y de la TV', to: '/master/estaciones', icon: Monitor },
    { done: !alerts.some((a) => a.type === 'default_pin'), label: 'Cambiar el PIN de fábrica del tótem', to: '/master/configuracion', icon: KeyRound },
  ]
  const pending = steps.filter((s) => !s.done).length

  return (
    <div className="fade-up space-y-6">
      <PageHeader
        title="Resumen de hoy"
        description="Se actualiza en vivo cuando cambia una cola."
        actions={canEdit && tot.total > 0 && (
          <Button variant="soft" size="sm" onClick={closeDay}>
            <Moon size={15} /> Cerrar el día
          </Button>
        )}
      />

      {canEdit && pending > 0 && setup.data && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line bg-brand-soft/50 px-5 py-3.5">
            <Rocket size={18} className="text-brand" />
            <div className="flex-1">
              <div className="font-semibold">Puesta en marcha</div>
              <div className="text-[13px] text-muted">Te faltan {pending} {pending === 1 ? 'paso' : 'pasos'} para dejar el sistema listo.</div>
            </div>
            <div className="h-2 w-28 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-brand" style={{ width: `${((steps.length - pending) / steps.length) * 100}%` }} />
            </div>
          </div>
          <ul className="divide-y divide-line">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={s.to} className="flex items-center gap-3 px-5 py-3 hover:bg-paper">
                  {s.done ? <CheckCircle2 size={18} className="text-ok" /> : <Circle size={18} className="text-muted" />}
                  <s.icon size={16} className="text-muted" />
                  <span className={s.done ? 'text-muted line-through' : 'font-medium'}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {alerts.filter((a) => a.type !== 'default_pin').length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) =>
            a.type === 'queue_high' ? (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn" role="alert">
                <AlertTriangle size={18} /> <b>{a.sectorName}</b> tiene {a.waiting} personas esperando (alerta desde {a.threshold}).
              </div>
            ) : a.type === 'station_stale' ? (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert">
                <MonitorOff size={18} /> {a.kind === 'tv' ? 'La TV' : 'El tótem'} <b>{a.name}</b> no se conecta desde las {hhmm(a.lastSeenAt)}.
              </div>
            ) : null,
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Turnos emitidos" value={tot.total} />
        <Kpi label="En espera" value={tot.waiting} tone={tot.waiting > 0 && oldest >= 30 ? 'danger' : undefined} sub={tot.waiting ? `La más larga: ${oldest} min` : undefined} />
        <Kpi label="En atención" value={tot.active} />
        <Kpi label="Atendidos" value={tot.done} sub={tot.absent ? `${tot.absent} ausentes` : undefined} />
        <Kpi label="Espera promedio" value={fmtMin(avgWait)} />
      </div>

      {sectors.length === 0 ? (
        <Empty icon={<Layers size={22} />} title="Todavía no hay secretarías" hint="Creá la primera en “Secretarías y botones” para empezar a emitir turnos." action={canEdit && <Link to="/master/secretarias"><Button>Crear secretaría</Button></Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sectors.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <div className="flex">
                <div className="w-1.5 shrink-0" style={{ background: s.color }} />
                <div className="flex-1 p-5">
                  <div className="flex items-center justify-between">
                    <div className="display text-lg font-semibold">{s.name}</div>
                    {s.waiting > 0 && <span className={`badge ${s.oldestWaitingMin >= 30 ? 'badge-danger' : s.oldestWaitingMin >= 15 ? 'badge-warn' : 'badge-ok'}`}>{Math.round(s.oldestWaitingMin)} min</span>}
                  </div>
                  <div className="mt-3 flex items-end gap-6">
                    <div>
                      <div className="num text-6xl leading-none">{s.waiting}</div>
                      <div className="mt-1 text-sm text-muted">en espera</div>
                    </div>
                    <div>
                      <div className="num text-3xl leading-none text-ink-soft">{s.active}</div>
                      <div className="mt-1 text-sm text-muted">en atención</div>
                    </div>
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
        {tk.data && tk.data.length === 0 ? (
          <Empty title="Aún no se emitió ningún turno hoy" hint="Abrí el tótem y sacá un turno de prueba." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="table-pro">
              <thead>
                <tr><th>Turno</th><th>Secretaría</th><th>Botón</th><th>Emitido</th><th>Llamado</th><th>Estado</th><th /></tr>
              </thead>
              <tbody>
                {tk.data?.slice(0, 80).map((t) => (
                  <tr key={t.id}>
                    <td className="num text-lg">{t.code}</td>
                    <td><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: t.sectorColor }} />{t.sectorName}</td>
                    <td className="text-muted">{t.label}{t.dni ? <span className="ml-1 text-xs">· DNI {t.dni}</span> : null}</td>
                    <td>{hhmm(t.createdAt)}</td>
                    <td>{hhmm(t.calledAt)}{t.desk ? ` · ${t.desk}` : ''}</td>
                    <td><span className={`badge ${STATUS[t.status]?.c}`}>{STATUS[t.status]?.t}</span></td>
                    <td className="text-right">{canEdit && ['waiting', 'called', 'serving'].includes(t.status) && <Button variant="ghost" size="sm" onClick={() => cancel(t)}>Cancelar</Button>}</td>
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
