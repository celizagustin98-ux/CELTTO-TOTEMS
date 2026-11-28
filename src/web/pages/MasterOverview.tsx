import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Activity, AlertTriangle, ShieldCheck, CheckCircle2, Circle, Clock, KeyRound, Layers, Monitor, MonitorOff, Moon, Rocket, Ticket, UserCheck, Users, Hourglass } from 'lucide-react'
import { api, type Stats } from '../lib/api'
import { fmtMin, hhmm, longDate } from '../lib/format'
import { useDebounced, useLive, useLoad } from '../lib/live'
import { can, useAuth } from '../auth'
import { BarChart, fillHours } from '../components/Charts'
import { Button, Empty, ErrorBox, SkeletonPage, StatCard, useConfirm, useToast } from '../ui'

interface Ov { date: string; sectors: (Stats & { id: number; name: string; color: string })[] }
interface TicketRow { id: number; code: string; status: string; sectorName: string; sectorColor: string; label: string; createdAt: string; calledAt: string | null; desk: string | null; dni: string | null; patientName: string | null }
type Alert = { type: 'mfa_recommended' } | { type: 'queue_high'; sectorName: string; waiting: number; threshold: number } | { type: 'station_stale'; name: string; kind: string; lastSeenAt: string } | { type: 'default_pin' }

export const STATUS: Record<string, { t: string; c: string }> = {
  waiting: { t: 'En espera', c: 'badge-warn' },
  called: { t: 'Llamado', c: 'badge-brand' },
  serving: { t: 'En atención', c: 'badge-brand' },
  done: { t: 'Atendido', c: 'badge-ok' },
  absent: { t: 'Ausente', c: 'badge-muted' },
  cancelled: { t: 'Cancelado', c: 'badge-danger' },
}
const greet = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }

export default function Overview() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const canEdit = can(user, 'config.manage')
  const canCancel = can(user, 'tickets.cancel')
  const canClose = can(user, 'day.close')
  const ov = useLoad(() => api<Ov>('/api/admin/overview'))
  const tk = useLoad(() => api<TicketRow[]>('/api/admin/tickets'))
  const al = useLoad(() => api<{ alerts: Alert[] }>('/api/admin/ops-alerts'))
  const hours = useLoad(() => api<{ byHour: { hour: string; count: number }[] }>('/api/admin/stats'))
  const setup = useLoad(() =>
    Promise.all([can(user, 'stations.manage') ? api<unknown[]>('/api/admin/stations') : Promise.resolve([]), canEdit ? api<{ role: string }[]>('/api/admin/users') : Promise.resolve(null)]).then(([st, us]) => ({
      stations: st.length,
      users: us ? us.filter((u) => u.role === 'secretary').length : 1,
    })),
  )
  const reload = useDebounced(() => {
    void ov.reload()
    void tk.reload()
    void al.reload()
    void hours.reload()
  }, 400)
  useLive((m) => {
    if (m.type === 'queue' || m.type === 'config' || m.type === 'call') reload()
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
    if (!(await confirm({ title: 'Cerrar el día', message: 'Se cancelan los turnos que quedaron en espera o en atención y se guarda el resumen del día.', confirmLabel: 'Cerrar el día', danger: true }))) return
    try {
      await api('/api/admin/day-close', { body: {} })
      toast('Día cerrado')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (ov.loading) return <SkeletonPage />
  if (ov.error) return <ErrorBox msg={ov.error} retry={ov.reload} />
  const sectors = ov.data!.sectors
  const tot = sectors.reduce((a, s) => ({ waiting: a.waiting + s.waiting, active: a.active + s.active, done: a.done + s.done, absent: a.absent + s.absent, total: a.total + s.total }), { waiting: 0, active: 0, done: 0, absent: 0, total: 0 })
  const waits = sectors.map((s) => s.avgWaitMin).filter((x): x is number => x != null)
  const avgWait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0
  const oldest = Math.max(0, ...sectors.map((s) => s.oldestWaitingMin))
  const alerts = al.data?.alerts ?? []
  const steps = [
    { done: sectors.length > 0, label: 'Crear una secretaría con sus botones', to: '/master/secretarias', icon: Layers },
    { done: (setup.data?.users ?? 0) > 0, label: 'Crear los usuarios de secretaría', to: '/master/usuarios', icon: Users },
    { done: (setup.data?.stations ?? 0) > 0, label: 'Generar la dirección del tótem y de la TV', to: '/master/estaciones', icon: Monitor },
    { done: !alerts.some((a) => a.type === 'default_pin'), label: 'Cambiar el PIN de fábrica del tótem', to: '/master/configuracion', icon: KeyRound },
  ]
  const pending = steps.filter((s) => !s.done).length
  const byHour = fillHours(hours.data?.byHour ?? [])
  const feed = (tk.data ?? []).slice(0, 8)

  return (
    <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }} className="space-y-6">
      <motion.div variants={item} className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="text-[13px] font-medium text-muted first-letter:uppercase">{longDate(Date.now())}</div>
          <h1 className="display mt-1 text-[2rem] font-semibold tracking-tight">
            <span className="text-gradient">{greet()}, {user?.displayName.split(' ')[0]}</span>
          </h1>
          <p className="mt-1 text-[14px] text-muted">Así viene la atención hoy. Todo se actualiza en vivo.</p>
        </div>
        {canClose && tot.total > 0 && <Button variant="soft" size="sm" onClick={closeDay}><Moon size={15} /> Cerrar el día</Button>}
      </motion.div>

      {canEdit && pending > 0 && setup.data && (
        <motion.div variants={item} className="surface overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line bg-gradient-to-r from-brand-soft/70 to-transparent px-5 py-4">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white shadow-lg shadow-brand/25"><Rocket size={18} /></span>
            <div className="flex-1">
              <div className="font-semibold">Puesta en marcha</div>
              <div className="text-[13px] text-muted">Te {pending === 1 ? 'falta 1 paso' : `faltan ${pending} pasos`} para dejar el sistema listo.</div>
            </div>
            <div className="hidden h-2 w-32 overflow-hidden rounded-full bg-line sm:block">
              <motion.div initial={{ width: 0 }} animate={{ width: `${((steps.length - pending) / steps.length) * 100}%` }} className="h-full rounded-full bg-brand" />
            </div>
          </div>
          <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={s.to} className="flex items-center gap-3 px-5 py-3.5 hover:bg-paper">
                  {s.done ? <CheckCircle2 size={18} className="text-ok" /> : <Circle size={18} className="text-muted" />}
                  <span className={s.done ? 'text-muted line-through' : 'font-medium'}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {alerts.some((a) => a.type === 'mfa_recommended') && (
        <motion.div variants={item}>
          <Link to="/cuenta" className="flex items-center gap-3 rounded-xl border border-brand/25 bg-brand-soft/60 px-4 py-3 text-[14px] hover:bg-brand-soft">
            <ShieldCheck size={18} className="text-brand" />
            <span className="flex-1">Protegé tu cuenta con <b>doble factor</b>: tenés acceso de administración y sin el código del celular nadie puede entrar aunque sepa tu contraseña.</span>
            <span className="text-[13px] font-medium text-brand">Activar →</span>
          </Link>
        </motion.div>
      )}

      {alerts.some((a) => a.type === 'queue_high' || a.type === 'station_stale') && (
        <motion.div variants={item} className="space-y-2">
          {alerts.map((a, i) =>
            a.type === 'queue_high' ? (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[14px] text-warn" role="alert"><AlertTriangle size={18} /> <b>{a.sectorName}</b> tiene {a.waiting} personas esperando (alerta desde {a.threshold}).</div>
            ) : a.type === 'station_stale' ? (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-danger/25 bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert"><MonitorOff size={18} /> {a.kind === 'tv' ? 'La TV' : 'El tótem'} <b>{a.name}</b> no se conecta desde las {hhmm(a.lastSeenAt)}.</div>
            ) : null,
          )}
        </motion.div>
      )}

      <motion.div variants={item} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Turnos emitidos" value={tot.total} icon={<Ticket size={16} />} hint={tot.absent ? `${tot.absent} ausentes` : 'Hoy'} />
        <StatCard label="En espera" value={tot.waiting} icon={<Hourglass size={16} />} tone={oldest >= 30 ? 'danger' : oldest >= 15 ? 'warn' : 'brand'} hint={tot.waiting ? `La más larga: ${oldest} min` : 'Sin espera'} />
        <StatCard label="Atendidos" value={tot.done} icon={<UserCheck size={16} />} tone="ok" hint={`${tot.active} en atención ahora`} />
        <StatCard label="Espera promedio" value={avgWait} icon={<Clock size={16} />} format={(n) => (n < 1 ? '<1 min' : `${Math.round(n)} min`)} hint="Desde que sacan turno hasta el llamado" />
      </motion.div>

      <motion.div variants={item} className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Turnos por hora</h2>
              <p className="text-[12.5px] text-muted">Demanda de hoy para planificar puestos.</p>
            </div>
            <Activity size={18} className="text-muted" />
          </div>
          <BarChart data={byHour} height={170} />
        </div>
        <div className="surface flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Actividad en vivo</h2>
            <span className="flex items-center gap-1.5 text-[12px] text-ok"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" /> En vivo</span>
          </div>
          {feed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Todavía no hay movimiento hoy.</p>
          ) : (
            <ul className="space-y-1">
              {feed.map((t, i) => (
                <motion.li key={t.id + t.status} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-paper">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.sectorColor }} />
                  <span className="num w-16 text-base">{t.code}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.patientName ?? <span className="text-muted">Sin identificar</span>}</span>
                  <span className={`badge ${STATUS[t.status]?.c}`}>{STATUS[t.status]?.t}</span>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>

      {sectors.length === 0 ? (
        <motion.div variants={item}>
          <Empty icon={<Layers size={22} />} title="Todavía no hay secretarías" hint="Creá la primera para empezar a emitir turnos." action={canEdit && <Link to="/master/secretarias"><Button>Crear secretaría</Button></Link>} />
        </motion.div>
      ) : (
        <motion.div variants={item}>
          <h2 className="display mb-3 text-lg font-semibold">Colas por secretaría</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sectors.map((s) => {
              const load = s.total ? Math.round(((s.done + s.absent) / s.total) * 100) : 0
              return (
                <div key={s.id} className="surface card-hover overflow-hidden p-5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-lg text-white" style={{ background: s.color }}><Layers size={16} /></span>
                    <div className="display min-w-0 flex-1 truncate text-lg font-semibold">{s.name}</div>
                    {s.waiting > 0 && <span className={`badge ${s.oldestWaitingMin >= 30 ? 'badge-danger' : s.oldestWaitingMin >= 15 ? 'badge-warn' : 'badge-ok'}`}>{s.oldestWaitingMin} min</span>}
                  </div>
                  <div className="mt-4 flex items-end gap-6">
                    <div>
                      <div className="num text-5xl leading-none">{s.waiting}</div>
                      <div className="mt-1 text-[12.5px] text-muted">en espera</div>
                    </div>
                    <div>
                      <div className="num text-2xl leading-none text-ink-soft">{s.active}</div>
                      <div className="mt-1 text-[12.5px] text-muted">en atención</div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="num text-2xl leading-none text-ink-soft">{fmtMin(s.avgWaitMin)}</div>
                      <div className="mt-1 text-[12.5px] text-muted">espera prom.</div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-[11.5px] text-muted"><span>{s.done} atendidos · {s.absent} ausentes</span><span>{load}%</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-paper">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${load}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full" style={{ background: s.color }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>
      )}

      <motion.section variants={item}>
        <h2 className="display mb-3 text-lg font-semibold">Turnos de hoy</h2>
        {tk.data && tk.data.length === 0 ? (
          <Empty title="Aún no se emitió ningún turno hoy" hint="Abrí el tótem y sacá un turno de prueba." />
        ) : (
          <div className="surface overflow-x-auto">
            <table className="table-pro">
              <thead><tr><th>Turno</th><th>Paciente</th><th>Secretaría</th><th>Motivo</th><th>Emitido</th><th>Llamado</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {tk.data?.slice(0, 80).map((t) => (
                  <tr key={t.id}>
                    <td className="num text-lg">{t.code}</td>
                    <td>{t.patientName ? <span className="font-medium">{t.patientName}</span> : <span className="text-muted">—</span>}{t.dni && <div className="font-mono text-[11.5px] text-muted">{t.dni}</div>}</td>
                    <td><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: t.sectorColor }} />{t.sectorName}</td>
                    <td className="text-muted">{t.label}</td>
                    <td>{hhmm(t.createdAt)}</td>
                    <td>{hhmm(t.calledAt)}{t.desk ? ` · ${t.desk}` : ''}</td>
                    <td><span className={`badge ${STATUS[t.status]?.c}`}>{STATUS[t.status]?.t}</span></td>
                    <td className="text-right">{canCancel && ['waiting', 'called', 'serving'].includes(t.status) && <Button variant="ghost" size="sm" onClick={() => cancel(t)}>Cancelar</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>
    </motion.div>
  )
}
