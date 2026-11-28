import { useState } from 'react'
import { Armchair, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, type Sector } from '../lib/api'
import { useLoad } from '../lib/live'
import { can, useAuth } from '../auth'
import { Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, inputCls, useConfirm, useToast } from '../ui'

type Desk = { id: number; sector_id: number; name: string; code: string }
type Form = { id?: number; sectorId: number; name: string; code: string }

export default function Desks() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const canEdit = can(user, 'desks.manage')
  const sectors = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const desks = useLoad(() => api<Desk[]>('/api/admin/desks'))
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      if (f.id) await api(`/api/admin/desks/${f.id}`, { method: 'PUT', body: { name: f.name, code: f.code } })
      else await api('/api/admin/desks', { body: { sectorId: f.sectorId, name: f.name, code: f.code } })
      toast('Puesto guardado')
      setF(null)
      await desks.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (d: Desk) => {
    if (!(await confirm({ title: 'Eliminar puesto', message: <>Se elimina <b>{d.name}</b>. Las secretarias que lo tenían asignado deben elegir otro.</>, confirmLabel: 'Eliminar', danger: true }))) return
    try {
      await api(`/api/admin/desks/${d.id}`, { method: 'PUT', body: { active: false } })
      toast('Puesto eliminado')
      await desks.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (sectors.loading || desks.loading) return <Spinner />
  if (sectors.error || desks.error) return <ErrorBox msg={(sectors.error ?? desks.error)!} retry={() => { void sectors.reload(); void desks.reload() }} />
  const secs = sectors.data!
  const list = desks.data!

  return (
    <div className="space-y-6">
      <PageHeader title="Escritorios y boxes" description="Puestos de atención de cada secretaría. La secretaria elige el suyo al entrar y la TV anuncia a dónde ir." />
      {secs.length === 0 ? (
        <Empty icon={<Armchair size={22} />} title="Primero creá una secretaría" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {secs.map((s) => {
            const mine = list.filter((d) => d.sector_id === s.id)
            return (
              <Card key={s.id} className="overflow-hidden">
                <div className="flex items-center gap-2 border-b border-line px-5 py-3">
                  <span className="h-3 w-3 rounded" style={{ background: s.color }} />
                  <h2 className="flex-1 font-semibold">{s.name}</h2>
                  <span className="text-xs text-muted">{mine.length} {mine.length === 1 ? 'puesto' : 'puestos'}</span>
                </div>
                <ul className="divide-y divide-line">
                  {mine.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Armchair size={16} className="text-muted" />
                      <span className="flex-1 font-medium">{d.name}</span>
                      <span className="rounded bg-paper px-1.5 font-mono text-xs text-muted">{d.code}</span>
                      {canEdit && (
                        <>
                          <button aria-label={`Editar ${d.name}`} onClick={() => setF({ id: d.id, sectorId: s.id, name: d.name, code: d.code })} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"><Pencil size={15} /></button>
                          <button aria-label={`Eliminar ${d.name}`} onClick={() => remove(d)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-danger"><Trash2 size={15} /></button>
                        </>
                      )}
                    </li>
                  ))}
                  {mine.length === 0 && <li className="px-5 py-4 text-sm text-muted">Sin puestos. Las secretarias escriben el suyo a mano.</li>}
                </ul>
                {canEdit && (
                  <div className="border-t border-line p-3">
                    <Button size="sm" variant="soft" onClick={() => setF({ sectorId: s.id, name: `Box ${list.length + 1}`, code: `B${list.length + 1}` })}><Plus size={15} />Agregar puesto</Button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
      {f && (
        <Modal title={f.id ? 'Editar puesto' : 'Nuevo puesto'} onClose={() => setF(null)} footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !f.name.trim() || !f.code.trim()}>Guardar</Button></>}>
          <Field label="Nombre" hint="Es lo que dice la TV (ej: Box 2, Ventanilla 3)."><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Código corto"><input className={inputCls} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={20} /></Field>
        </Modal>
      )}
    </div>
  )
}
