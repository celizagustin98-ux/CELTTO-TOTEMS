import { useMemo, useState } from 'react'
import { Crown, KeyRound, Pencil, Plus, Search, ShieldCheck, ShieldOff, Trash2, Users } from 'lucide-react'
import { api, type Role, type Sector } from '../lib/api'
import { ago } from '../lib/format'
import { useLoad } from '../lib/live'
import { ROLE_LABEL, can, useAuth } from '../auth'
import { Avatar, Button, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, inputCls, useConfirm, useToast } from '../ui'

interface Row { id: number; username: string; displayName: string; role: Role; sectorId: number | null; sectorName: string | null; desk: string | null; deskId: number | null; siteId: number | null; active: boolean; lastLoginAt: string | null; mfaEnabled: boolean; areaSectorIds: number[] }
interface Desk { id: number; sector_id: number; name: string }
interface Site { id: number; name: string; active: boolean }
interface RolesInfo { roles: Record<Role, { label: string; description: string }>; perms: Record<Role, string[]>; permissions: Record<string, string>; manageable: Role[] }
type Form = { id?: number; username: string; displayName: string; password: string; role: Role; sectorId: number | null; deskId: number | null; desk: string; siteId: number | null; areaSectorIds: number[]; active: boolean }

const ROLE_BADGE: Record<Role, string> = { owner: 'badge-brand', admin: 'badge-brand', supervisor: 'badge-ok', tech: 'badge-warn', auditor: 'badge-muted', secretary: 'badge-muted' }
const ROLE_ORDER: Role[] = ['owner', 'admin', 'supervisor', 'tech', 'auditor', 'secretary']

export default function UsersPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user: me, logout } = useAuth()
  const users = useLoad(() => api<Row[]>('/api/admin/users'))
  const sectors = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const desks = useLoad(() => api<Desk[]>('/api/admin/desks'))
  const sites = useLoad(() => api<Site[]>('/api/admin/sites'))
  const roles = useLoad(() => api<RolesInfo>('/api/admin/roles'))
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')
  const [matrix, setMatrix] = useState(false)
  const [transfer, setTransfer] = useState<{ userId: number | null; password: string } | null>(null)
  const manageable = roles.data?.manageable ?? []
  const canManage = (r: Role) => manageable.includes(r)

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (users.data ?? [])
      .filter((u) => (!roleFilter || u.role === roleFilter) && (!term || u.displayName.toLowerCase().includes(term) || u.username.includes(term) || (u.sectorName ?? '').toLowerCase().includes(term)))
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.displayName.localeCompare(b.displayName))
  }, [users.data, q, roleFilter])

  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      const common = {
        displayName: f.displayName, role: f.role, siteId: f.siteId,
        sectorId: f.role === 'secretary' ? f.sectorId : null,
        deskId: f.role === 'secretary' ? f.deskId : null,
        desk: f.role === 'secretary' && !f.deskId ? f.desk || null : undefined,
        areaSectorIds: f.role === 'supervisor' ? f.areaSectorIds : [],
      }
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
    if (!(await confirm({ title: 'Eliminar usuario', message: <>Se elimina a <b>{u.displayName}</b> y se cierra su sesión. Si ya atendió turnos, se da de baja conservando el historial.</>, confirmLabel: 'Eliminar', danger: true }))) return
    try {
      const r = await api<{ archived: boolean }>(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      toast(r.archived ? 'Usuario dado de baja (se conserva su historial)' : 'Usuario eliminado')
      await users.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const resetMfa = async (u: Row) => {
    if (!(await confirm({ title: 'Reiniciar doble factor', message: <>Se quita el doble factor de <b>{u.displayName}</b> (por ejemplo, si perdió el celular). Va a tener que configurarlo de nuevo.</>, confirmLabel: 'Reiniciar', danger: true }))) return
    try {
      await api(`/api/admin/users/${u.id}/reset-mfa`, { method: 'POST' })
      toast('Doble factor reiniciado')
      await users.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const doTransfer = async () => {
    if (!transfer?.userId) return
    setBusy(true)
    try {
      await api('/api/admin/ownership/transfer', { body: transfer })
      toast('Control maestro transferido. Volvé a iniciar sesión.')
      await logout()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (users.loading || sectors.loading || roles.loading) return <Spinner />
  if (users.error || sectors.error) return <ErrorBox msg={(users.error ?? sectors.error)!} retry={() => { void users.reload(); void sectors.reload() }} />
  const secs = sectors.data!
  const deskList = desks.data ?? []
  const siteList = (sites.data ?? []).filter((s) => s.active)
  const info = roles.data!
  const canSave = f && f.displayName.trim() && (f.role !== 'secretary' || f.sectorId) && (f.role !== 'supervisor' || f.areaSectorIds.length) && (f.id ? !f.password || f.password.length >= 8 : f.username.trim().length >= 3 && f.password.length >= 8)
  const blank = (): Form => ({ username: '', displayName: '', password: '', role: 'secretary', sectorId: secs[0]?.id ?? null, deskId: null, desk: '', siteId: null, areaSectorIds: [], active: true })
  const admins = (users.data ?? []).filter((u) => u.role === 'admin' && u.active)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios y permisos"
        description="Cada usuario tiene un rol con permisos definidos. El control maestro es el único con control total."
        actions={
          <>
            <Button variant="soft" onClick={() => setMatrix(true)}><KeyRound size={16} /> Ver permisos por rol</Button>
            {manageable.length > 0 && <Button onClick={() => setF(blank())}><Plus size={18} /> Nuevo usuario</Button>}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ROLE_ORDER.map((r) => {
          const n = (users.data ?? []).filter((u) => u.role === r && u.active).length
          return (
            <button key={r} onClick={() => setRoleFilter(roleFilter === r ? '' : r)} className={`surface card-hover p-3 text-left ${roleFilter === r ? 'ring-2 ring-brand/50' : ''}`}>
              <div className="flex items-center gap-1.5 text-[12px] text-muted">{r === 'owner' && <Crown size={12} className="text-warn" />}{info.roles[r].label}</div>
              <div className="num mt-1 text-2xl">{n}</div>
            </button>
          )
        })}
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className={`${inputCls} pl-9`} placeholder="Buscar por nombre, usuario o secretaría" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar usuarios" />
      </div>

      {rows.length === 0 ? (
        <Empty icon={<Users size={22} />} title={q || roleFilter ? 'Ningún usuario coincide' : 'Todavía no hay usuarios'} />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="table-pro">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Alcance</th><th>Seguridad</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
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
                  <td><span className={`badge ${ROLE_BADGE[u.role]}`}>{u.role === 'owner' && <Crown size={11} />}{ROLE_LABEL[u.role]}</span></td>
                  <td className="text-[13px]">
                    {u.role === 'secretary' ? (u.sectorName ? <>{u.sectorName}{u.desk ? <span className="text-muted"> · {u.desk}</span> : null}</> : <span className="text-danger">Sin asignar</span>)
                      : u.role === 'supervisor' ? <span>{u.areaSectorIds.map((id) => secs.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || <span className="text-danger">Sin áreas</span>}</span>
                      : <span className="text-muted">Todo el sistema</span>}
                  </td>
                  <td>{u.mfaEnabled ? <span className="badge badge-ok"><ShieldCheck size={11} /> Doble factor</span> : <span className="badge badge-muted">Solo contraseña</span>}</td>
                  <td className="text-muted" title={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('es-AR') : undefined}>{ago(u.lastLoginAt)}</td>
                  <td><span className={`badge ${u.active ? 'badge-ok' : 'badge-muted'}`}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="whitespace-nowrap text-right">
                    {canManage(u.role) && (
                      <>
                        {u.mfaEnabled && <button aria-label={`Reiniciar doble factor de ${u.displayName}`} title="Reiniciar doble factor" onClick={() => resetMfa(u)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"><ShieldOff size={16} /></button>}
                        <button aria-label={`Editar ${u.displayName}`} onClick={() => setF({ id: u.id, username: u.username, displayName: u.displayName, password: '', role: u.role, sectorId: u.sectorId, deskId: u.deskId, desk: u.desk ?? '', siteId: u.siteId, areaSectorIds: u.areaSectorIds, active: u.active })} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"><Pencil size={16} /></button>
                        <button aria-label={`Eliminar ${u.displayName}`} onClick={() => remove(u)} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-danger"><Trash2 size={16} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {can(me, 'ownership.transfer') && (
        <div className="surface flex flex-wrap items-center gap-4 p-5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-warn-soft text-warn"><Crown size={20} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Control maestro</div>
            <p className="text-[13px] text-muted">Sos el responsable con control total. Podés transferirlo a un administrador (vos pasás a ser administrador). Si se pierde el acceso, se recupera con el comando de consola <code>owner:create</code> en el servidor.</p>
          </div>
          <Button variant="soft" onClick={() => setTransfer({ userId: admins[0]?.id ?? null, password: '' })} disabled={admins.length === 0}>Transferir control</Button>
        </div>
      )}

      {f && (
        <Modal wide title={f.id ? 'Editar usuario' : 'Nuevo usuario'} onClose={() => setF(null)} footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !canSave}>Guardar</Button></>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre y apellido"><input className={inputCls} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} autoFocus /></Field>
            <Field label="Usuario" hint={f.id ? 'No se puede cambiar.' : 'Sin espacios (ej: maria.lopez).'}><input className={inputCls} value={f.username} disabled={!!f.id} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, '') })} autoComplete="off" /></Field>
          </div>
          <Field label={f.id ? 'Nueva contraseña' : 'Contraseña'} hint={f.id ? 'Dejala vacía para no cambiarla.' : 'Mínimo 8 caracteres.'}>
            <input className={inputCls} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Rol">
            <div className="grid gap-2 sm:grid-cols-2">
              {manageable.map((r) => (
                <button key={r} type="button" aria-pressed={f.role === r} onClick={() => setF({ ...f, role: r })} className={`rounded-xl border p-3 text-left transition ${f.role === r ? 'border-brand bg-brand-soft/60 ring-1 ring-brand' : 'border-line hover:bg-paper'}`}>
                  <div className="text-[14px] font-semibold">{info.roles[r].label}</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-muted">{info.roles[r].description}</div>
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
                <Field label="Puesto" hint="También lo puede elegir al entrar.">
                  <select className={inputCls} value={f.deskId ?? ''} onChange={(e) => setF({ ...f, deskId: Number(e.target.value) || null })}>
                    <option value="">Sin puesto fijo</option>
                    {deskList.filter((d) => d.sector_id === f.sectorId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Puesto"><input className={inputCls} value={f.desk} onChange={(e) => setF({ ...f, desk: e.target.value })} placeholder="Box 1" /></Field>
              )}
            </div>
          )}
          {f.role === 'supervisor' && (
            <Field label="Secretarías a cargo" hint="Ve las colas, reportes y productividad solo de estas secretarías.">
              <div className="flex flex-wrap gap-2">
                {secs.map((s) => {
                  const on = f.areaSectorIds.includes(s.id)
                  return (
                    <button key={s.id} type="button" aria-pressed={on} onClick={() => setF({ ...f, areaSectorIds: on ? f.areaSectorIds.filter((x) => x !== s.id) : [...f.areaSectorIds, s.id] })} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium ${on ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-paper'}`}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}
                    </button>
                  )
                })}
              </div>
            </Field>
          )}
          {siteList.length > 1 && (
            <Field label="Sede" hint="Opcional. Para organizar usuarios por sede.">
              <select className={inputCls} value={f.siteId ?? ''} onChange={(e) => setF({ ...f, siteId: Number(e.target.value) || null })}>
                <option value="">Todas</option>
                {siteList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          {f.id && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[var(--color-brand)]" />
              Usuario activo (si lo desactivás, se cierra su sesión)
            </label>
          )}
        </Modal>
      )}

      {matrix && (
        <Modal wide title="Permisos por rol" onClose={() => setMatrix(false)}>
          <div className="overflow-x-auto">
            <table className="table-pro text-[13px]">
              <thead><tr><th>Permiso</th>{ROLE_ORDER.map((r) => <th key={r} className="text-center">{info.roles[r].label}</th>)}</tr></thead>
              <tbody>
                {Object.entries(info.permissions).map(([p, label]) => (
                  <tr key={p}>
                    <td>{label}</td>
                    {ROLE_ORDER.map((r) => <td key={r} className="text-center">{info.perms[r].includes(p) ? <span className="text-ok">●</span> : <span className="text-line-strong">–</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {transfer && (
        <Modal title="Transferir el control maestro" onClose={() => setTransfer(null)} footer={<><Button variant="soft" onClick={() => setTransfer(null)}>Cancelar</Button><Button variant="danger" onClick={doTransfer} disabled={busy || !transfer.userId || !transfer.password}>Transferir</Button></>}>
          <p className="text-[13.5px] text-muted">El usuario elegido pasa a tener control total y vos quedás como administrador. Se cierran las sesiones de ambos.</p>
          <Field label="Nuevo control maestro">
            <select className={inputCls} value={transfer.userId ?? ''} onChange={(e) => setTransfer({ ...transfer, userId: Number(e.target.value) || null })}>
              {admins.map((a) => <option key={a.id} value={a.id}>{a.displayName} ({a.username})</option>)}
            </select>
          </Field>
          <Field label="Tu contraseña (para confirmar)"><input type="password" className={inputCls} value={transfer.password} onChange={(e) => setTransfer({ ...transfer, password: e.target.value })} autoComplete="current-password" /></Field>
        </Modal>
      )}
    </div>
  )
}
