import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarClock, ChevronLeft, ChevronRight, Contact, Download, IdCard, Mail, Pencil, Phone, Plus, Search, Trash2, UserPlus, X } from 'lucide-react'
import { api } from '../lib/api'
import { ago, dateTime } from '../lib/format'
import { useDebounced } from '../lib/live'
import { MANAGERS, useAuth } from '../auth'
import { Avatar, Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, StatCard, inputCls, useConfirm, useToast } from '../ui'
import { STATUS } from './MasterOverview'

type Patient = { id: number; documentType: string; document: string; firstName: string; lastName: string; phone: string | null; email: string | null; birthDate: string | null; notes: string | null; visits: number; lastVisitAt: string | null; source: string; createdAt: string }
type Detail = Patient & { tickets: { id: number; code: string; status: string; created_at: string; called_at: string | null; desk: string | null; sector_name: string; sector_color: string; label: string; attended_by: string | null }[] }
type Page = { total: number; page: number; size: number; newLast30: number; rows: Patient[] }
type Form = { id?: number; documentType: string; document: string; firstName: string; lastName: string; phone: string; email: string; birthDate: string; notes: string }

const DOC_TYPES = ['DNI', 'PAS', 'LE', 'LC', 'CI', 'OTRO']
const fmtDoc = (t: string, d: string) => (t === 'DNI' && /^\d+$/.test(d) ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : d)
const age = (iso: string | null) => {
  if (!iso) return null
  const b = new Date(iso)
  const n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--
  return a
}

export default function Patients() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const canManage = !!user && MANAGERS.includes(user.role)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (p = page, term = q) => {
    setLoading(true)
    try {
      setData(await api<Page>(`/api/admin/patients?page=${p}&size=25&q=${encodeURIComponent(term)}`))
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  const search = useDebounced(() => {
    setPage(1)
    void load(1, q)
  }, 300)
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const open = async (id: number) => {
    try {
      setDetail(await api<Detail>(`/api/admin/patients/${id}`))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      const body = { documentType: f.documentType, document: f.document, firstName: f.firstName, lastName: f.lastName, phone: f.phone || null, email: f.email || '', birthDate: f.birthDate || '', notes: f.notes || null }
      if (f.id) await api(`/api/admin/patients/${f.id}`, { method: 'PUT', body })
      else await api('/api/admin/patients', { body })
      toast('Paciente guardado')
      setF(null)
      if (detail && f.id === detail.id) void open(detail.id)
      await load()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (p: Patient) => {
    if (!(await confirm({ title: 'Eliminar paciente', message: <>Se eliminan los datos personales de <b>{p.firstName} {p.lastName}</b>. Si tiene turnos, se conservan de forma anónima para las estadísticas.</>, confirmLabel: 'Eliminar', danger: true }))) return
    try {
      await api(`/api/admin/patients/${p.id}`, { method: 'DELETE' })
      toast('Paciente eliminado')
      setDetail(null)
      await load()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const edit = (p: Patient) => setF({ id: p.id, documentType: p.documentType, document: p.document, firstName: p.firstName, lastName: p.lastName, phone: p.phone ?? '', email: p.email ?? '', birthDate: p.birthDate ?? '', notes: p.notes ?? '' })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.size)) : 1

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pacientes"
        description="Cada paciente que se identifica en el tótem queda registrado con su historial de visitas."
        actions={
          <>
            {canManage && (
              <a href="/api/admin/patients/export.csv" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[14px] font-medium hover:bg-paper">
                <Download size={15} /> Exportar
              </a>
            )}
            {canManage && <Button onClick={() => setF({ documentType: 'DNI', document: '', firstName: '', lastName: '', phone: '', email: '', birthDate: '', notes: '' })}><UserPlus size={17} /> Nuevo paciente</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Pacientes registrados" value={data?.total ?? 0} icon={<Contact size={16} />} />
        <StatCard label="Nuevos últimos 30 días" value={data?.newLast30 ?? 0} icon={<UserPlus size={16} />} tone="ok" />
        <div className="col-span-2 lg:col-span-1">
          <div className="surface flex h-full items-center gap-3 p-4">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><IdCard size={18} /></span>
            <p className="text-[13px] leading-snug text-muted">El tótem pide el documento; si el paciente no existe, se registra solo con nombre, apellido y DNI.</p>
          </div>
        </div>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className={`${inputCls} h-11 pl-10`}
          placeholder="Buscar por nombre, apellido o documento"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            search()
          }}
          aria-label="Buscar pacientes"
        />
      </div>

      {err && <ErrorBox msg={err} retry={() => void load()} />}

      <div className="surface overflow-hidden">
        {loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : data && data.rows.length === 0 ? (
          <Empty icon={<Contact size={22} />} title={q ? 'Ningún paciente coincide' : 'Todavía no hay pacientes'} hint={q ? 'Probá con otro nombre o documento.' : 'Se cargan solos cuando sacan turno en el tótem.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-pro">
              <thead><tr><th>Paciente</th><th>Documento</th><th>Contacto</th><th>Visitas</th><th>Última visita</th><th /></tr></thead>
              <tbody>
                {data?.rows.map((p, i) => (
                  <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }} className="cursor-pointer" onClick={() => void open(p.id)}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={`${p.firstName} ${p.lastName}`} size={34} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{p.lastName}, {p.firstName}</div>
                          <div className="text-xs text-muted">Alta {ago(p.createdAt).toLowerCase()} · {p.source === 'totem' ? 'desde el tótem' : 'desde el panel'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-[13px]"><span className="mr-1.5 text-[11px] text-muted">{p.documentType}</span>{fmtDoc(p.documentType, p.document)}</td>
                    <td className="text-[13px] text-muted">{p.phone || p.email || '—'}</td>
                    <td><span className="badge badge-brand">{p.visits}</span></td>
                    <td className="text-muted">{ago(p.lastVisitAt)}</td>
                    <td className="text-right"><ChevronRight size={16} className="inline text-muted" /></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.size && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px] text-muted">
            <span>{(page - 1) * data.size + 1}–{Math.min(page * data.size, data.total)} de {data.total}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="soft" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft size={15} /></Button>
              <Button size="sm" variant="soft" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Página siguiente"><ChevronRight size={15} /></Button>
            </div>
          </div>
        )}
      </div>

      {/* Ficha del paciente */}
      <AnimatePresence>
        {detail && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[1px]" onClick={() => setDetail(null)} />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
              role="dialog"
              aria-label="Ficha del paciente"
            >
              <div className="flex items-start gap-3 border-b border-line p-5">
                <Avatar name={`${detail.firstName} ${detail.lastName}`} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="display text-xl font-semibold leading-tight">{detail.firstName} {detail.lastName}</div>
                  <div className="mt-0.5 font-mono text-[13px] text-muted">{detail.documentType} {fmtDoc(detail.documentType, detail.document)}</div>
                </div>
                <button onClick={() => setDetail(null)} className="rounded-md p-1.5 text-muted hover:bg-paper" aria-label="Cerrar"><X size={18} /></button>
              </div>
              <div className="flex-1 space-y-5 overflow-auto p-5 scrollbar-thin">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['Visitas', String(detail.visits)],
                    ['Última', ago(detail.lastVisitAt)],
                    ['Edad', age(detail.birthDate) != null ? `${age(detail.birthDate)} años` : '—'],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-paper p-3">
                      <div className="text-[11.5px] text-muted">{k}</div>
                      <div className="mt-0.5 truncate font-semibold">{v}</div>
                    </div>
                  ))}
                </div>
                <dl className="space-y-2.5 text-[14px]">
                  <div className="flex items-center gap-2.5"><Phone size={15} className="text-muted" />{detail.phone || <span className="text-muted">Sin teléfono</span>}</div>
                  <div className="flex items-center gap-2.5"><Mail size={15} className="text-muted" />{detail.email || <span className="text-muted">Sin email</span>}</div>
                  <div className="flex items-center gap-2.5"><CalendarClock size={15} className="text-muted" />Registrado el {dateTime(detail.createdAt)}</div>
                </dl>
                {detail.notes && <p className="rounded-xl border border-warn/25 bg-warn-soft px-3 py-2.5 text-[13.5px] text-warn">{detail.notes}</p>}
                <div>
                  <h3 className="mb-2 text-[13px] font-semibold text-muted">Historial de turnos</h3>
                  {detail.tickets.length === 0 ? (
                    <p className="text-sm text-muted">Todavía no sacó turnos.</p>
                  ) : (
                    <ol className="relative space-y-3 border-l border-line pl-4">
                      {detail.tickets.map((t) => (
                        <li key={t.id} className="relative">
                          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface" style={{ background: t.sector_color }} />
                          <div className="flex items-center gap-2">
                            <span className="num text-lg">{t.code}</span>
                            <span className={`badge ${STATUS[t.status]?.c}`}>{STATUS[t.status]?.t}</span>
                          </div>
                          <div className="text-[13px] text-muted">{t.label} · {t.sector_name}{t.attended_by ? ` · ${t.attended_by}` : ''}</div>
                          <div className="text-[12px] text-muted">{dateTime(t.created_at)}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
              <div className="flex gap-2 border-t border-line p-4">
                <Button variant="soft" className="flex-1" onClick={() => edit(detail)}><Pencil size={15} /> Editar</Button>
                {canManage && <Button variant="ghost" className="!text-danger" onClick={() => remove(detail)} aria-label="Eliminar paciente"><Trash2 size={16} /></Button>}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {f && (
        <Modal wide title={f.id ? 'Editar paciente' : 'Nuevo paciente'} onClose={() => setF(null)} footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !f.document.trim() || f.firstName.trim().length < 2 || f.lastName.trim().length < 2}><Plus size={15} />Guardar</Button></>}>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <Field label="Tipo"><select className={inputCls} value={f.documentType} onChange={(e) => setF({ ...f, documentType: e.target.value })}>{DOC_TYPES.map((d) => <option key={d}>{d}</option>)}</select></Field>
            <Field label="Número de documento"><input className={inputCls} value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} autoFocus inputMode="numeric" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre"><input className={inputCls} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
            <Field label="Apellido"><input className={inputCls} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
            <Field label="Teléfono"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
            <Field label="Email"><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Fecha de nacimiento"><input className={inputCls} type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} /></Field>
          </div>
          <Field label="Observaciones" hint="Visibles para la secretaria al atender (ej.: necesita silla de ruedas)."><textarea className={inputCls} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={500} /></Field>
        </Modal>
      )}
    </div>
  )
}
