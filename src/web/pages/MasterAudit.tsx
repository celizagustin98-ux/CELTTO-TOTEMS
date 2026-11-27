import { useMemo, useState } from 'react'
import { ScrollText, Search } from 'lucide-react'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'
import { useLoad } from '../lib/live'
import { Card, Empty, ErrorBox, PageHeader, Spinner, inputCls } from '../ui'

type Row = { id: number; action: string; entity: string | null; entity_id: string | null; detail: string | null; ip: string | null; created_at: string; user_name: string | null }

const ACTIONS: Record<string, { t: string; c: string }> = {
  'login.ok': { t: 'Inicio de sesión', c: 'badge-ok' },
  'login.fail': { t: 'Contraseña incorrecta', c: 'badge-warn' },
  'login.blocked': { t: 'Acceso bloqueado', c: 'badge-danger' },
  logout: { t: 'Cierre de sesión', c: 'badge-muted' },
  'password.change': { t: 'Cambio de contraseña', c: 'badge-brand' },
  'station.bind.fail': { t: 'PIN de tótem incorrecto', c: 'badge-warn' },
}
const label = (a: string) => ACTIONS[a]?.t ?? a.replace('.', ' · ')

export default function Audit() {
  const { data, error, loading, reload } = useLoad(() => api<Row[]>('/api/admin/audit?limit=500'))
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data ?? []).filter((r) => !t || [r.action, label(r.action), r.user_name, r.ip, r.detail].some((x) => (x ?? '').toLowerCase().includes(t)))
  }, [data, q])

  if (loading) return <Spinner />
  if (error) return <ErrorBox msg={error} retry={reload} />
  return (
    <div className="space-y-6">
      <PageHeader title="Auditoría" description="Quién hizo qué y cuándo: accesos, cambios de configuración, usuarios y turnos cancelados. Se muestran los últimos 500 registros." />
      <div className="relative max-w-md">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className={`${inputCls} pl-9`} placeholder="Buscar por acción, usuario o IP" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar en auditoría" />
      </div>
      {rows.length === 0 ? (
        <Empty icon={<ScrollText size={22} />} title="Sin registros" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-pro">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-muted">{dateTime(r.created_at)}</td>
                  <td>{r.user_name ?? <span className="text-muted">—</span>}</td>
                  <td><span className={`badge ${ACTIONS[r.action]?.c ?? 'badge-muted'}`}>{label(r.action)}</span></td>
                  <td className="max-w-md truncate font-mono text-xs text-muted" title={r.detail ?? undefined}>{r.detail ?? (r.entity ? `${r.entity} #${r.entity_id}` : '')}</td>
                  <td className="font-mono text-xs text-muted">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
