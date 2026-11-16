import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { api, type Sector } from '../lib/api'
import { useLoad } from '../lib/live'
import { Button, Card, Empty, ErrorBox, Field, Modal, Spinner, inputCls, useToast } from '../ui'

interface Row { id: number; username: string; displayName: string; sectorId: number | null; sectorName: string | null; desk: string | null; active: boolean }
type Form = { id?: number; username: string; displayName: string; password: string; sectorId: number; desk: string; active: boolean }

export default function UsersPage() {
  const toast = useToast()
  const users = useLoad(() => api<Row[]>('/api/admin/users'))
  const sectors = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      if (f.id) await api(`/api/admin/users/${f.id}`, { method: 'PUT', body: { displayName: f.displayName, sectorId: f.sectorId, desk: f.desk || null, active: f.active, ...(f.password ? { password: f.password } : {}) } })
      else await api('/api/admin/users', { body: { username: f.username, displayName: f.displayName, password: f.password, sectorId: f.sectorId, desk: f.desk || null } })
      toast('Usuario guardado'); setF(null); await users.reload()
    } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  if (users.loading || sectors.loading) return <Spinner />
  if (users.error || sectors.error) return <ErrorBox msg={(users.error ?? sectors.error)!} retry={() => { void users.reload(); void sectors.reload() }} />
  const secs = sectors.data!
  const rows = users.data!
  const canSave = f && f.displayName.trim() && f.sectorId && (f.id ? true : f.username.trim().length >= 3 && f.password.length >= 8) && (!f.id || !f.password || f.password.length >= 8)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="display text-3xl font-semibold">Usuarios de secretaría</h1><p className="max-w-xl text-sm text-muted">Cada usuario entra al panel de su secretaría y ve solo esa cola. Una secretaría puede tener varios usuarios.</p></div>
        <Button disabled={secs.length === 0} onClick={() => setF({ username: '', displayName: '', password: '', sectorId: secs[0].id, desk: '', active: true })}><Plus size={18} />Nuevo usuario</Button>
      </header>
      {secs.length === 0 ? <Empty title="Primero creá una secretaría" hint="Los usuarios se vinculan a una secretaría." /> : rows.length === 0 ? <Empty title="Todavía no hay usuarios" hint="Creá uno y asignalo a la secretaría que va a atender." /> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted"><tr><th className="px-4 py-3 font-medium">Nombre</th><th className="px-4 py-3 font-medium">Usuario</th><th className="px-4 py-3 font-medium">Secretaría</th><th className="px-4 py-3 font-medium">Puesto</th><th className="px-4 py-3 font-medium">Estado</th><th /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-line/70 last:border-0">
                  <td className="px-4 py-3 font-medium">{u.displayName}</td><td className="px-4 py-3 text-muted">{u.username}</td>
                  <td className="px-4 py-3">{u.sectorName ?? <span className="text-danger">Sin asignar</span>}</td><td className="px-4 py-3">{u.desk ?? '—'}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${u.active ? 'bg-emerald-100 text-emerald-900' : 'bg-zinc-200 text-zinc-700'}`}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="px-4 py-3 text-right"><button aria-label={`Editar ${u.displayName}`} onClick={() => setF({ id: u.id, username: u.username, displayName: u.displayName, password: '', sectorId: u.sectorId ?? secs[0].id, desk: u.desk ?? '', active: u.active })} className="rounded-md p-1.5 text-muted hover:bg-paper"><Pencil size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {f && (
        <Modal title={f.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={() => setF(null)} footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !canSave}>Guardar</Button></>}>
          <Field label="Nombre y apellido"><input className={inputCls} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} autoFocus /></Field>
          <Field label="Usuario" hint={f.id ? 'El nombre de usuario no se puede cambiar.' : 'Para iniciar sesión. Sin espacios (ej: maria.lopez).'}><input className={inputCls} value={f.username} disabled={!!f.id} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoComplete="off" /></Field>
          <Field label={f.id ? 'Nueva contraseña' : 'Contraseña'} hint={f.id ? 'Dejala vacía para no cambiarla. Mínimo 8 caracteres.' : 'Mínimo 8 caracteres.'}><input className={inputCls} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Secretaría"><select className={inputCls} value={f.sectorId} onChange={(e) => setF({ ...f, sectorId: Number(e.target.value) })}>{secs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Puesto" hint="Se anuncia al llamar (ej: Box 2)."><input className={inputCls} value={f.desk} onChange={(e) => setF({ ...f, desk: e.target.value })} placeholder="Box 1" /></Field>
          </div>
          {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4" />Usuario activo (si lo desactivás, se cierra su sesión)</label>}
        </Modal>
      )}
    </div>
  )
}
