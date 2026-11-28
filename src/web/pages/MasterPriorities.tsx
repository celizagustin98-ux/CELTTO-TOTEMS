import { useState } from 'react'
import { Flag, Pencil, Plus } from 'lucide-react'
import { api, type Priority } from '../lib/api'
import { useLoad } from '../lib/live'
import { can, useAuth } from '../auth'
import { Button, Card, ColorPicker, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, inputCls, useToast } from '../ui'

type Form = { id?: number; name: string; weight: number; color: string; active: boolean }

export default function Priorities() {
  const toast = useToast()
  const { user } = useAuth()
  const canEdit = can(user, 'priorities.manage')
  const { data, error, loading, reload } = useLoad(() => api<Priority[]>('/api/admin/priorities'))
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      const body = { name: f.name, weight: f.weight, color: f.color, active: f.active }
      if (f.id) await api(`/api/admin/priorities/${f.id}`, { method: 'PUT', body })
      else await api('/api/admin/priorities', { body })
      toast('Prioridad guardada')
      setF(null)
      await reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />
  if (error) return <ErrorBox msg={error} retry={reload} />
  const rows = data!
  const max = Math.max(1, ...rows.map((r) => r.weight))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prioridades"
        description="Cada botón del tótem tiene una prioridad. En la cola pasan primero los turnos con más peso; a igual peso, por orden de llegada."
        actions={canEdit && <Button onClick={() => setF({ name: '', weight: 5, color: '#2563eb', active: true })}><Plus size={18} />Nueva prioridad</Button>}
      />
      {rows.length === 0 ? (
        <Empty icon={<Flag size={22} />} title="No hay prioridades" />
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((p) => (
            <div key={p.id} className={`flex items-center gap-4 px-5 py-4 ${p.active ? '' : 'opacity-50'}`}>
              <span className="h-9 w-9 shrink-0 rounded-lg" style={{ background: p.color ?? '#64748b' }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  {p.name}
                  {!p.active && <span className="badge badge-muted">Inactiva</span>}
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-paper">
                    <div className="h-full rounded-full" style={{ width: `${(p.weight / max) * 100}%`, background: p.color ?? '#64748b' }} />
                  </div>
                  <span className="text-xs text-muted">Peso {p.weight}</span>
                </div>
              </div>
              {canEdit && (
                <button aria-label={`Editar ${p.name}`} onClick={() => setF({ id: p.id, name: p.name, weight: p.weight, color: p.color ?? '#64748b', active: p.active })} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink">
                  <Pencil size={16} />
                </button>
              )}
            </div>
          ))}
        </Card>
      )}
      {f && (
        <Modal title={f.id ? 'Editar prioridad' : 'Nueva prioridad'} onClose={() => setF(null)} footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !f.name.trim()}>Guardar</Button></>}>
          <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Preferencial" autoFocus /></Field>
          <Field label="Peso" hint="Número de 0 a 1000. Mayor peso = pasa antes en la cola.">
            <input className={inputCls} type="number" min={0} max={1000} value={f.weight} onChange={(e) => setF({ ...f, weight: Number(e.target.value) })} />
          </Field>
          <Field label="Color"><ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} /></Field>
          {f.id && <Toggle checked={f.active} onChange={(active) => setF({ ...f, active })} label="Activa" hint="Las inactivas no se pueden asignar a botones nuevos." />}
        </Modal>
      )}
    </div>
  )
}
