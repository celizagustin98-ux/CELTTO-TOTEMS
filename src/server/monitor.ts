import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from './db.js'
import { businessDate } from './db.js'
import { HttpError } from './errors.js'
import { requirePerm } from './auth.js'
import { safeEqual } from './security.js'

/** Métricas en memoria del proceso (se reinician al reiniciar la app). */
const m = {
  startedAt: Date.now(),
  requests: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } as Record<string, number>,
  ticketsIssued: 0,
  calls: 0,
  errors: [] as { at: string; method: string; url: string; message: string }[],
  dbLatencyMs: 0,
  dbOk: true,
}
const loop = monitorEventLoopDelay({ resolution: 20 })
loop.enable()

export const metrics = {
  request(status: number) {
    const k = `${Math.floor(status / 100)}xx`
    m.requests[k] = (m.requests[k] ?? 0) + 1
  },
  error(method: string, url: string, message: string) {
    m.errors.unshift({ at: new Date().toISOString(), method, url: url.split('?')[0].slice(0, 120), message: message.slice(0, 300) })
    m.errors.length = Math.min(m.errors.length, 50)
  },
  ticket() {
    m.ticketsIssued++
  },
  call() {
    m.calls++
  },
}

/** Mide la latencia de la base cada 30 s (también sirve para detectar caídas). */
export function startDbProbe(ctx: Ctx) {
  const probe = async () => {
    const t0 = Date.now()
    try {
      await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
      m.dbOk = true
    } catch {
      m.dbOk = false
    }
    m.dbLatencyMs = Date.now() - t0
  }
  void probe()
  return setInterval(probe, 30_000).unref()
}

/** Estado que deja el servicio de respaldo (deploy/linux/backup.sh) en BACKUP_DIR/status.json. */
function backupStatus(ctx: Ctx) {
  const f = join(ctx.cfg.backupDir, 'status.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as { lastOk?: string; lastFile?: string; lastSizeBytes?: number; lastError?: string; lastVerifyOk?: string }
  } catch {
    return null
  }
}

async function snapshot(ctx: Ctx) {
  const now = Date.now()
  const stations = await ctx.db.selectFrom('stations').select(['id', 'name', 'kind', 'last_seen_at']).where('active', '=', 1).execute()
  const online = stations.filter((s) => s.last_seen_at && now - Date.parse(s.last_seen_at) < 5 * 60_000).length
  const today = businessDate(ctx.cfg.timezone)
  const waiting = Number((await ctx.db.selectFrom('tickets').select((eb) => eb.fn.countAll<number>().as('n')).where('business_date', '=', today).where('status', '=', 'waiting').executeTakeFirstOrThrow()).n)
  let dbSizeBytes: number | null = null
  if (ctx.client === 'postgres') {
    try {
      const { sql } = await import('kysely')
      const r = await sql<{ size: string }>`select pg_database_size(current_database())::text as size`.execute(ctx.db)
      dbSizeBytes = Number(r.rows[0]?.size ?? 0)
    } catch {
      dbSizeBytes = null
    }
  }
  const mem = process.memoryUsage()
  const backup = backupStatus(ctx)
  const backupAgeH = backup?.lastOk ? (now - Date.parse(backup.lastOk)) / 3_600_000 : null
  const checks = [
    { id: 'db', label: 'Base de datos', ok: m.dbOk && m.dbLatencyMs < 500, detail: m.dbOk ? `${m.dbLatencyMs} ms` : 'Sin conexión' },
    { id: 'loop', label: 'Respuesta del servidor', ok: loop.percentile(99) / 1e6 < 200, detail: `p99 ${Math.round(loop.percentile(99) / 1e6)} ms` },
    { id: 'stations', label: 'Tótems y TVs', ok: stations.length === 0 || online === stations.length, detail: `${online} de ${stations.length} en línea` },
    { id: 'errors', label: 'Errores (última hora)', ok: m.errors.filter((e) => now - Date.parse(e.at) < 3_600_000).length === 0, detail: `${m.errors.filter((e) => now - Date.parse(e.at) < 3_600_000).length}` },
    { id: 'backup', label: 'Respaldo', ok: backupAgeH != null && backupAgeH < 26, detail: backup?.lastOk ? `hace ${Math.round(backupAgeH!)} h` : 'Sin datos de respaldo' },
  ]
  return {
    version: ctx.cfg.version,
    instance: ctx.cfg.instanceId,
    uptimeSec: Math.round((now - m.startedAt) / 1000),
    db: { client: ctx.client, ok: m.dbOk, latencyMs: m.dbLatencyMs, sizeBytes: dbSizeBytes },
    eventLoopP99Ms: Math.round(loop.percentile(99) / 1e6),
    memory: { rssMb: Math.round(mem.rss / 1e6), heapMb: Math.round(mem.heapUsed / 1e6) },
    websocket: { clients: ctx.hub.size, mode: ctx.hub.mode },
    requests: m.requests,
    ticketsIssued: m.ticketsIssued,
    calls: m.calls,
    waitingNow: waiting,
    stations: { total: stations.length, online, list: stations.map((s) => ({ ...s, online: !!s.last_seen_at && now - Date.parse(s.last_seen_at) < 5 * 60_000 })) },
    backup,
    errors: m.errors.slice(0, 30),
    checks,
    healthy: checks.every((c) => c.ok),
  }
}

export function monitorRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/admin/monitor', { preHandler: requirePerm(ctx, 'monitor.view') }, async () => snapshot(ctx))

  /**
   * Formato Prometheus para Grafana/alertas externas. Requiere METRICS_TOKEN
   * (cabecera "Authorization: Bearer <token>"). Sin token configurado, la ruta no existe.
   */
  app.get('/api/metrics', async (req, reply) => {
    const token = ctx.cfg.metricsToken
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    if (!token || !safeEqual(auth, token)) throw new HttpError(404, 'No encontrado')
    const s = await snapshot(ctx)
    const lines = [
      '# HELP celtto_up Aplicación en funcionamiento', '# TYPE celtto_up gauge', 'celtto_up 1',
      '# TYPE celtto_uptime_seconds gauge', `celtto_uptime_seconds ${s.uptimeSec}`,
      '# TYPE celtto_db_up gauge', `celtto_db_up ${s.db.ok ? 1 : 0}`,
      '# TYPE celtto_db_latency_ms gauge', `celtto_db_latency_ms ${s.db.latencyMs}`,
      '# TYPE celtto_event_loop_p99_ms gauge', `celtto_event_loop_p99_ms ${s.eventLoopP99Ms}`,
      '# TYPE celtto_memory_rss_mb gauge', `celtto_memory_rss_mb ${s.memory.rssMb}`,
      '# TYPE celtto_ws_clients gauge', `celtto_ws_clients ${s.websocket.clients}`,
      '# TYPE celtto_stations_online gauge', `celtto_stations_online ${s.stations.online}`,
      '# TYPE celtto_stations_total gauge', `celtto_stations_total ${s.stations.total}`,
      '# TYPE celtto_tickets_waiting gauge', `celtto_tickets_waiting ${s.waitingNow}`,
      '# TYPE celtto_tickets_issued_total counter', `celtto_tickets_issued_total ${s.ticketsIssued}`,
      '# TYPE celtto_calls_total counter', `celtto_calls_total ${s.calls}`,
      '# TYPE celtto_http_requests_total counter',
      ...Object.entries(s.requests).map(([k, v]) => `celtto_http_requests_total{class="${k}"} ${v}`),
      '# TYPE celtto_healthy gauge', `celtto_healthy ${s.healthy ? 1 : 0}`,
    ]
    reply.header('Content-Type', 'text/plain; version=0.0.4')
    return lines.join('\n') + '\n'
  })
}
