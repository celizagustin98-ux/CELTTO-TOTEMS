import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api, type Btn, type Sector } from '../lib/api'
import { PALETTE, PRIORITY, textOn } from '../lib/format'
import { useLoad } from '../lib/live'
import { Button, Card, ColorPicker, Empty, ErrorBox, Field, Modal, Spinner, inputCls, useToast } from '../ui'

type SectorForm = { id?: number; name: string; color: string; welcomeMessage: string }
type BtnForm = { id?: number; sectorId: number; targetSectorId: number; label: string; subtitle: string; color: string; prefix: string; priority: number }

export default function Sectors() {
  const toast = useToast()
  const { data, error, loading, reload } = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const [sf, setSf] = useState<SectorForm | null>(null)
  const [bf, setBf] = useState<BtnForm | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, ok: string, close: () => void) => {
    setBusy(true)
    try { await fn(); toast(ok); close(); await reload() } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  const saveSector = () => run(() => {
    const body = { name: sf!.name, color: sf!.color, welcomeMessage: sf!.welcomeMessage || null }
    return sf!.id ? api(`/api/admin/sectors/${sf!.id}`, { method: 'PUT', body }) : api('/api/admin/sectors', { body })
  }, 'Secretaría guardada', () => setSf(null))
  const saveBtn = () => run(() => {
    const b = bf!
    const body = { sectorId: b.sectorId, targetSectorId: b.targetSectorId, label: b.label, subtitle: b.subtitle || null, color: b.color || null, prefix: b.prefix, priority: b.priority }
    return b.id ? api(`/api/admin/buttons/${b.id}`, { method: 'PUT', body }) : api('/api/admin/buttons', { body })
  }, 'Botón guardado', () => setBf(null))
  const delSector = (s: Sector) => confirm(`¿Eliminar la secretaría "${s.name}" y sus botones?`) && run(() => api(`/api/admin/sectors/${s.id}`, { method: 'DELETE' }), 'Secretaría eliminada', () => {})
  const delBtn = (b: Btn) => confirm(`¿Eliminar el botón "${b.label}"?`) && run(() => api(`/api/admin/buttons/${b.id}`, { method: 'DELETE' }), 'Botón eliminado', () => {})
  const newBtn = (s: Sector) => setBf({ sectorId: s.id, targetSectorId: s.id, label: '', subtitle: '', color: '', prefix: '', priority: 0 })

  if (loading) return <Spinner />
  if (error) return <ErrorBox msg={error} retry={reload} />
  const sectors = data!
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="display text-3xl font-semibold">Secretarías y botones</h1><p className="max-w-xl text-sm text-muted">Cada secretaría tiene su cola y sus botones. Cada botón que toca el paciente genera un turno.</p></div>
        <Button onClick={() => setSf({ name: '', color: PALETTE[sectors.length % PALETTE.length], welcomeMessage: '' })}><Plus size={18} />Nueva secretaría</Button>
      </header>
      {sectors.length === 0 && <Empty title="Creá tu primera secretaría" hint="Por ejemplo “Secretaría A”, con los botones “Turno nuevo” y “Continuar atención”." />}
      <div className="grid gap-5 lg:grid-cols-2">
        {sectors.map((s) => (
          <Card key={s.id} className="overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4" style={{ background: s.color, color: textOn(s.color) }}>
              <h2 className="display flex-1 text-xl font-semibold">{s.name}</h2>
              <button aria-label="Editar secretaría" onClick={() => setSf({ id: s.id, name: s.name, color: s.color, welcomeMessage: s.welcomeMessage ?? '' })} className="rounded-md p-1.5 hover:bg-black/10"><Pencil size={17} /></button>
              <button aria-label="Eliminar secretaría" onClick={() => delSector(s)} className="rounded-md p-1.5 hover:bg-black/10"><Trash2 size={17} /></button>
            </div>
            <ul className="divide-y divide-line">
              {s.buttons.map((b) => {
                const dest = sectors.find((x) => x.id === b.targetSectorId)
                return (
                  <li key={b.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="num grid h-10 min-w-10 place-items-center rounded-md px-2 text-lg" style={{ background: b.color ?? s.color, color: textOn(b.color ?? s.color) }}>{b.prefix}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{b.label}</div>
                      <div className="truncate text-xs text-muted">Prioridad {PRIORITY.find((p) => p.v === b.priority)?.label.toLowerCase() ?? b.priority}{dest && dest.id !== s.id ? ` · va a ${dest.name}` : ''}</div>
                    </div>
                    <button aria-label="Editar botón" onClick={() => setBf({ id: b.id, sectorId: b.sectorId, targetSectorId: b.targetSectorId, label: b.label, subtitle: b.subtitle ?? '', color: b.color ?? '', prefix: b.prefix, priority: b.priority })} className="rounded-md p-1.5 text-muted hover:bg-paper"><Pencil size={16} /></button>
                    <button aria-label="Eliminar botón" onClick={() => delBtn(b)} className="rounded-md p-1.5 text-muted hover:bg-paper"><Trash2 size={16} /></button>
                  </li>
                )
              })}
              {s.buttons.length === 0 && <li className="px-5 py-4 text-sm text-muted">Esta secretaría todavía no tiene botones.</li>}
            </ul>
            <div className="border-t border-line p-3"><Button variant="soft" size="sm" onClick={() => newBtn(s)}><Plus size={16} />Agregar botón</Button></div>
          </Card>
        ))}
      </div>

      {sf && (
        <Modal title={sf.id ? 'Editar secretaría' : 'Nueva secretaría'} onClose={() => setSf(null)} footer={<><Button variant="soft" onClick={() => setSf(null)}>Cancelar</Button><Button onClick={saveSector} disabled={busy || !sf.name.trim()}>Guardar</Button></>}>
          <Field label="Nombre"><input className={inputCls} value={sf.name} onChange={(e) => setSf({ ...sf, name: e.target.value })} placeholder="Secretaría A" autoFocus /></Field>
          <Field label="Color de la secretaría" hint="Es el color que se ve en el tótem y en la pantalla cuando llaman."><ColorPicker value={sf.color} onChange={(color) => setSf({ ...sf, color })} /></Field>
          <Field label="Mensaje de bienvenida del tótem" hint="Opcional."><input className={inputCls} value={sf.welcomeMessage} onChange={(e) => setSf({ ...sf, welcomeMessage: e.target.value })} placeholder="Bienvenido. Tocá una opción para sacar tu turno." /></Field>
        </Modal>
      )}

      {bf && (
        <Modal title={bf.id ? 'Editar botón' : 'Nuevo botón'} onClose={() => setBf(null)} footer={<><Button variant="soft" onClick={() => setBf(null)}>Cancelar</Button><Button onClick={saveBtn} disabled={busy || !bf.label.trim() || !bf.prefix.trim()}>Guardar</Button></>}>
          <Field label="Texto del botón"><input className={inputCls} value={bf.label} onChange={(e) => setBf({ ...bf, label: e.target.value })} placeholder="Turno nuevo" autoFocus /></Field>
          <Field label="Descripción" hint="Opcional. Se muestra debajo del texto."><input className={inputCls} value={bf.subtitle} onChange={(e) => setBf({ ...bf, subtitle: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Letra del turno" hint="Genera A-001, A-002…"><input className={`${inputCls} uppercase`} maxLength={3} value={bf.prefix} onChange={(e) => setBf({ ...bf, prefix: e.target.value.replace(/[^a-zA-Z0-9]/g, '') })} placeholder="A" /></Field>
            <Field label="Prioridad" hint="Mayor pasa adelante en la cola."><select className={inputCls} value={bf.priority} onChange={(e) => setBf({ ...bf, priority: Number(e.target.value) })}>{PRIORITY.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}</select></Field>
          </div>
          <Field label="Cola de destino" hint="Normalmente es la misma secretaría. Cambiala si este botón envía al paciente a otra.">
            <select className={inputCls} value={bf.targetSectorId} onChange={(e) => setBf({ ...bf, targetSectorId: Number(e.target.value) })}>{sectors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </Field>
          <Field label="Color propio" hint="Opcional. Si no elegís uno, usa el de la secretaría.">
            <div className="flex items-center gap-3"><ColorPicker value={bf.color || sectors.find((x) => x.id === bf.sectorId)?.color || '#2f6fed'} onChange={(color) => setBf({ ...bf, color })} />{bf.color && <Button variant="ghost" size="sm" onClick={() => setBf({ ...bf, color: '' })}>Quitar</Button>}</div>
          </Field>
        </Modal>
      )}
    </div>
  )
}
