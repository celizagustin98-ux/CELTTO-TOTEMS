import { useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { api, type Role, type Sector } from '../lib/api'
import { ago } from '../lib/format'
import { useLoad } from '../lib/live'
import { ROLE_LABEL, useAuth } from '../auth'
import { Avatar, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, inputCls, useConfirm, useToast } from '../ui'

interface Row { id: number; username: string; displayName: string; role: Role; sectorId: number | null; sectorName: string | null; desk: string | null; deskId: number | null; active: boolean; lastLoginAt: string | null }
interface Desk { id: number; sector_id: number; name: string }
type Form = { id?: number; username: string; displayName: string; password: string; role: Exclude<Role, 'owner'>; sectorId: number | null; deskId: number | null; desk: string; active: boolean }

const ROLE_HINT: Record<Exclude<Role, 'owner'>, string> = {
  secretary: 'Atiende la cola de su secretaría desde el panel de atención.',
  tech: 'Ve el panel maestro y administra tótems y TVs. No cambia configuración ni usuarios.',
  admin: 'Administra todo el sistema salvo al dueño.',
}
const ROLE_BADGE: Record<Role, string> = { owner: 'badge-brand', admin: 'badge-brand', tech: 'badge-warn', secretary: 'badge-muted' }

export default function UsersPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user: me } = useAuth()
  const users = useLoad(() => api<Row[]>('/api/admin/users'))
  const sectors = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const desks = useLoad(() => api<Desk[]>('/api/admin/desks'))
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')

  const allowedRoles: Exclude<Role, 'owner'>[] = me?.role === 'owner' ? ['secretary', 'tech', 'admin'] : ['secretary', 'tech']
  const canManage = (r: Role) => (me?.role === 'owner' ? r !== 'owner' : r === 'secretary' || r === 'tech')

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (users.data ?? []).filter((u) => (!roleFilter || u.role === roleFilter) && (!term || u.displayName.toLowerCase().includes(term) || u.username.includes(term) || (u.sectorName ?? '').toLowerCase().includes(term)))
  }, [users.data, q, roleFilter])

  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      const common = { displayName: f.displayName, role: f.role, sectorId: f.role === 'secretary' ? f.sectorId : null, deskId: f.role === 'secretary' ? f.deskId : null, desk: f.role === 'secretary' && !f.deskId ? f.desk || null : undefined }
      if (f.id) await api(`/api/admin/users/${f.id}`, { method: 'PUT', body: { ...common, active: f.active, ...(f.password ? { password: f.password } : {}) } })
      else await api('/api/admin/users', { body: { ...common, username: f.username, password: f.password } })
      toast('Usuario guardado')
      setF(null)
      await users.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (u: Row) => {
    if (!(await confirm({ title: 'Eliminar usuario', message: <>Se elimina a <b>{u.displayName}</b> y se cierra su sesión. Si ya atendió turnos, se da de baja conservando el historial para los reportes.</>, confirmLabel: 'Eliminar', danger: true }))) return
    try {
      const r = await api<{ archived: boolean }>(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      toast(r.archived ? 'Usuario dado de baja (se conserva su historial)' : 'Usuario eliminado')
      await users.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (users.loading || sectors.loading) return <Spinner />
  if (users.error || sectors.error) return <ErrorBox msg={(users.error ?? sectors.error)!} retry={() => { void users.reload(); void sectors.reload() }} />
  const secs = sectors.data!
  const deskList = desks.data ?? []
  const canSave = f && f.displayName.trim() && (f.role !== 'secretary' || f.sectorId) && (f.id ? !f.password || f.password.length >= 8 : f.username.trim().length >= 3 && f.password.length >= 8)
  const blank = (): Form => ({ username: '', displayName: '', password: '', role: 'secretary', sectorId: secs[0]?.id ?? null, deskId: null, desk: '', active: true })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        description="Secretarias, técnicos y administradores. Cada secretaria ve solo la cola de su secretaría."
        actions={<Button onClick={() => setF(blank())}><Plus size={18} />Nuevo usuario</Button>}
      />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} pl-9`} placeholder="Buscar por nombre, usuario o secretaría" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar usuarios" />
        </div>
        <select className={`${inputCls} !w-auto`} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | '')} aria-label="Filtrar por rol">
          <option value="">Todos los roles</option>
          {(['owner', 'admin', 'tech', 'secretary'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <Empty icon={<Users size={22} />} title={q || roleFilter ? 'Ningún usuario coincide' : 'Todavía no hay usuarios'} hint={q || roleFilter ? 'Probá con otra búsqueda.' : 'Creá uno y asignalo a la secretaría que va a atender.'} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-pro">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Secretaría · puesto</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.displayName} size={34} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.displayName}{u.id === me?.id && <span className="ml-1.5 text-xs text-muted">(vos)</span>}</div>
                        <div className="text-xs text-muted">{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`badge ${ROLE_BADGE[u.role]}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td>{u.role === 'secretary' ? (u.sectorName ? <>{u.sectorName}{u.desk ? <span className="text-muted"> · {u.desk}</span> : null}</> : <span className="text-danger">Sin asignar</span>) : <span className="text-muted">—</span>}</td>
                  <td className="text-muted" title={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('es-AR') : undefined}>{ago(u.lastLoginAt)}</td>
                  <td><span className={`badge ${u.active ? 'badge-ok' : 'badge-muted'}`}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="whitespace-nowrap text-right">
                    {canManage(u.role) && (
                      <>
                        <button aria-label={`Editar ${u.displayName}`} onClick={() => setF({ id: u.id, username: u.username, displayName: u.displayName, password: '', role: u.role as Form['role'], sectorId: u.sectorId, deskId: u.deskId, desk: u.desk ?? '', active: u.active })} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"><Pencil size={16} /></button>
                        <button aria-label={`Eliminar ${u.displayName}`} onClick={() => remove(u)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-danger"><Trash2 size={16} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {f && (
        <Modal
          title={f.id ? 'Editar usuario' : 'Nuevo usuario'}
          onClose={() => setF(null)}
          footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !canSave}>Guardar</Button></>}
        >
          <Field label="Nombre y apellido"><input className={inputCls} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} autoFocus /></Field>
          <Field label="Usuario" hint={f.id ? 'El nombre de usuario no se puede cambiar.' : 'Para iniciar sesión. Sin espacios (ej: maria.lopez).'}>
            <input className={inputCls} value={f.username} disabled={!!f.id} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') })} autoComplete="off" />
          </Field>
          <Field label={f.id ? 'Nueva contraseña' : 'Contraseña'} hint={f.id ? 'Dejala vacía para no cambiarla. Al cambiarla se cierran sus sesiones.' : 'Mínimo 8 caracteres.'}>
            <input className={inputCls} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Rol" hint={ROLE_HINT[f.role]}>
            <div className="grid grid-cols-3 gap-2">
              {allowedRoles.map((r) => (
                <button key={r} type="button" aria-pressed={f.role === r} onClick={() => setF({ ...f, role: r })} className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${f.role === r ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-paper'}`}>
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
          </Field>
          {f.role === 'secretary' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Secretaría">
                <select className={inputCls} value={f.sectorId ?? ''} onChange={(e) => setF({ ...f, sectorId: Number(e.target.value) || null, deskId: null })}>
                  {secs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              {deskList.some((d) => d.sector_id === f.sectorId) ? (
                <Field label="Puesto" hint="La secretaria también lo puede elegir al entrar.">
                  <select className={inputCls} value={f.deskId ?? ''} onChange={(e) => setF({ ...f, deskId: Number(e.target.value) || null })}>
                    <option value="">Sin puesto fijo</option>
                    {deskList.filter((d) => d.sector_id === f.sectorId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Puesto" hint="Se anuncia al llamar (ej: Box 2).">
                  <input className={inputCls} value={f.desk} onChange={(e) => setF({ ...f, desk: e.target.value })} placeholder="Box 1" />
                </Field>
              )}
            </div>
          )}
          {f.id && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" />
              Usuario activo (si lo desactivás, se cierra su sesión)
            </label>
          )}
        </Modal>
      )}
    </div>
  )
}
