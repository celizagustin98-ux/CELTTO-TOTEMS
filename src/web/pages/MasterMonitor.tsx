import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, AlertOctagon, CheckCircle2, Cpu, Database, HardDriveDownload, MemoryStick, Monitor, RefreshCw, Server, Tv, Wifi, XCircle } from 'lucide-react'
import { api } from '../lib/api'
import { ago, dateTime } from '../lib/format'
import { useLoad, useNow } from '../lib/live'
import { Button, ErrorBox, PageHeader, SkeletonPage } from '../ui'

type Snap = {
  version: string
  instance: string
  uptimeSec: number
  db: { client: string; ok: boolean; latencyMs: number; sizeBytes: number | null }
  eventLoopP99Ms: number
  memory: { rssMb: number; heapMb: number }
  websocket: { clients: number; mode: string }
  requests: Record<string, number>
  ticketsIssued: number
  calls: number
  waitingNow: number
  stations: { total: number; online: number; list: { id: number; name: string; kind: string; last_seen_at: string | null; online: boolean }[] }
  backup: { lastOk?: string; lastFile?: string; lastSizeBytes?: number; lastError?: string; lastVerifyOk?: string } | null
  errors: { at: string; method: string; url: string; message: string }[]
  checks: { id: string; label: string; ok: boolean; detail: string }[]
  healthy: boolean
}
const mb = (b: number | null | undefined) => (b == null ? '—' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)
const up = (s: number) => (s > 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`)

export default function MonitorPage() {
  const snap = useLoad(() => api<Snap>('/api/admin/monitor'))
  const now = useNow(15_000)
  useEffect(() => {
    const id = setInterval(() => void snap.reload(), 15_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (snap.loading) return <SkeletonPage />
  if (snap.error) return <ErrorBox msg={snap.error} retry={snap.reload} />
  const s = snap.data!
  const total = Object.values(s.requests).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoreo"
        description="Estado del sistema en tiempo real. Se actualiza cada 15 segundos."
        actions={<Button variant="soft" size="sm" onClick={snap.reload}><RefreshCw size={14} /> Actualizar</Button>}
      />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex items-center gap-4 rounded-2xl border p-5 ${s.healthy ? 'border-ok/30 bg-ok-soft/60' : 'border-danger/30 bg-danger-soft/60'}`}>
        <span className={`grid h-12 w-12 place-items-center rounded-xl ${s.healthy ? 'bg-ok text-white' : 'bg-danger text-white'}`}>{s.healthy ? <CheckCircle2 size={24} /> : <AlertOctagon size={24} />}</span>
        <div className="flex-1">
          <div className="display text-xl font-semibold">{s.healthy ? 'Todo funciona correctamente' : 'Hay puntos para revisar'}</div>
          <div className="text-[13px] text-muted">Versión {s.version} · {s.instance} · encendido hace {up(s.uptimeSec)}</div>
        </div>
      </motion.div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {s.checks.map((c) => (
          <div key={c.id} className="surface p-4">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              {c.ok ? <CheckCircle2 size={16} className="text-ok" /> : <XCircle size={16} className="text-danger" />}
              {c.label}
            </div>
            <div className="mt-1.5 text-[13px] text-muted">{c.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: Database, label: 'Base de datos', value: s.db.ok ? `${s.db.latencyMs} ms` : 'Caída', sub: `${s.db.client === 'postgres' ? 'PostgreSQL' : s.db.client === 'mssql' ? 'SQL Server' : s.db.client} · ${mb(s.db.sizeBytes)}` },
          { icon: Cpu, label: 'Respuesta del servidor', value: `${s.eventLoopP99Ms} ms`, sub: 'demora máxima (p99)' },
          { icon: MemoryStick, label: 'Memoria', value: `${s.memory.rssMb} MB`, sub: `${s.memory.heapMb} MB en uso` },
          { icon: Wifi, label: 'Pantallas conectadas', value: String(s.websocket.clients), sub: s.websocket.mode === 'redis' ? 'Tiempo real con Redis' : 'Tiempo real en memoria' },
          { icon: Activity, label: 'Turnos emitidos', value: String(s.ticketsIssued), sub: `${s.waitingNow} esperando ahora · desde el último reinicio` },
          { icon: Server, label: 'Peticiones', value: String(total), sub: `${s.requests['5xx'] ?? 0} errores 5xx · ${s.requests['4xx'] ?? 0} rechazadas` },
          { icon: HardDriveDownload, label: 'Último respaldo', value: s.backup?.lastOk ? ago(s.backup.lastOk, now) : 'Sin datos', sub: s.backup?.lastOk ? `${mb(s.backup.lastSizeBytes)} · verificado ${s.backup.lastVerifyOk ? ago(s.backup.lastVerifyOk, now).toLowerCase() : 'nunca'}` : 'Configurá el servicio de respaldo (docker compose)' },
          { icon: Monitor, label: 'Tótems y TVs', value: `${s.stations.online}/${s.stations.total}`, sub: 'en línea en los últimos 5 min' },
        ].map((k) => (
          <div key={k.label} className="surface p-4">
            <div className="flex items-center justify-between text-[13px] text-muted">{k.label}<k.icon size={16} /></div>
            <div className="num mt-1.5 text-2xl">{k.value}</div>
            <div className="mt-1 text-[12px] text-muted">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <h2 className="mb-3 font-semibold">Equipos</h2>
          {s.stations.list.length === 0 ? (
            <p className="text-sm text-muted">No hay tótems ni TVs registrados.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.stations.list.map((st) => (
                <li key={st.id} className="flex items-center gap-3 py-2.5">
                  {st.kind === 'tv' ? <Tv size={16} className="text-muted" /> : <Monitor size={16} className="text-muted" />}
                  <span className="flex-1 truncate text-[14px]">{st.name}</span>
                  <span className={`badge ${st.online ? 'badge-ok' : st.last_seen_at ? 'badge-danger' : 'badge-muted'}`}>{st.online ? 'En línea' : st.last_seen_at ? `Sin conexión · ${ago(st.last_seen_at, now).toLowerCase()}` : 'Sin usar'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="surface p-5">
          <h2 className="mb-3 font-semibold">Errores recientes</h2>
          {s.errors.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={15} /> Sin errores desde el último reinicio.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-auto scrollbar-thin">
              {s.errors.map((e, i) => (
                <li key={i} className="rounded-lg bg-danger-soft/60 px-3 py-2">
                  <div className="flex justify-between gap-3 text-[12px] text-muted"><span className="font-mono">{e.method} {e.url}</span><span>{dateTime(e.at)}</span></div>
                  <div className="mt-0.5 text-[13px] text-danger">{e.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-[12px] text-muted">Para Grafana/Prometheus: configurá <code>METRICS_TOKEN</code> y consultá <code>/api/metrics</code> con la cabecera <code>Authorization: Bearer …</code>.</p>
    </div>
  )
}
