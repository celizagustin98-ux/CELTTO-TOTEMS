import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

export type DbClient = 'postgres' | 'mssql' | 'sqlite'

export interface Config {
  port: number
  host: string
  client: DbClient
  isProd: boolean
  postgres: {
    host: string
    port: number
    database: string
    user: string
    password: string
    ssl: boolean
    poolMax: number
    poolMin: number
    idleTimeoutMs: number
  }
  mssql: {
    server: string
    port: number
    instance?: string
    database: string
    user: string
    password: string
    encrypt: boolean
    trustCert: boolean
  }
  sqlitePath: string
  timezone: string
  cookieSecure: boolean
  sessionHours: number
  sessionSecret: string
  webDir: string
  autoMigrate: boolean
  logger: boolean
  redisUrl?: string
  instanceId: string
  ticketRatePerMinute: number
  ticketRatePerDevice: number
  /** false, true o cantidad de proxies delante (recomendado: 1 con Caddy). */
  trustProxy: boolean | number
  version: string
  wsMaxClients: number
  wsMaxPerIp: number
}

const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === '' ? d : ['1', 'true', 'yes', 'si'].includes(v.toLowerCase())

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const isProd = (env.NODE_ENV ?? '').toLowerCase() === 'production'
  const raw = (env.DB_CLIENT ?? 'postgres').toLowerCase()
  const client: DbClient = raw === 'mssql' ? 'mssql' : raw === 'sqlite' ? 'sqlite' : 'postgres'
  const root = fileURLToPath(new URL('../..', import.meta.url))
  let version = '0.0.0'
  try { version = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version ?? version } catch { /* sin package.json */ }

  let sessionSecret = env.SESSION_SECRET?.trim() || ''
  if (!sessionSecret) {
    if (isProd) {
      throw new Error('SESSION_SECRET es obligatorio en producción (cadena larga aleatoria).')
    }
    sessionSecret = randomBytes(32).toString('hex')
  }
  if (isProd && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en producción.')
  }

  const pgPassword = env.POSTGRES_PASSWORD ?? env.PGPASSWORD ?? ''
  const mssqlPassword = env.MSSQL_PASSWORD ?? ''
  if (isProd && client === 'postgres') {
    if (!pgPassword || pgPassword === 'cambiar-esta-clave' || pgPassword.length < 12) {
      throw new Error('POSTGRES_PASSWORD débil o por defecto. Usá una clave fuerte en producción.')
    }
  }
  if (isProd && client === 'mssql' && (!mssqlPassword || mssqlPassword.length < 12)) {
    throw new Error('MSSQL_PASSWORD débil. Usá una clave fuerte en producción.')
  }
  if (isProd && client === 'sqlite') {
    throw new Error('SQLite no está permitido en NODE_ENV=production.')
  }

  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    client,
    isProd,
    postgres: {
      host: env.POSTGRES_HOST ?? env.PGHOST ?? 'localhost',
      port: Number(env.POSTGRES_PORT ?? env.PGPORT ?? 5432),
      database: env.POSTGRES_DATABASE ?? env.PGDATABASE ?? 'celtto_totems',
      user: env.POSTGRES_USER ?? env.PGUSER ?? 'celtto',
      password: pgPassword,
      ssl: bool(env.POSTGRES_SSL, false),
      poolMax: Number(env.PG_POOL_MAX ?? 20),
      poolMin: Number(env.PG_POOL_MIN ?? 2),
      idleTimeoutMs: Number(env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    },
    mssql: {
      server: env.MSSQL_SERVER ?? 'localhost',
      port: Number(env.MSSQL_PORT ?? 1433),
      instance: env.MSSQL_INSTANCE || undefined,
      database: env.MSSQL_DATABASE ?? 'celtto_totems',
      user: env.MSSQL_USER ?? 'sa',
      password: mssqlPassword,
      encrypt: bool(env.MSSQL_ENCRYPT, false),
      trustCert: bool(env.MSSQL_TRUST_CERT, true),
    },
    sqlitePath: env.SQLITE_PATH ?? `${root}data/celtto.db`,
    timezone: env.APP_TIMEZONE ?? 'America/Argentina/Cordoba',
    cookieSecure: bool(env.COOKIE_SECURE, isProd),
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    sessionSecret,
    webDir: `${root}dist/web`,
    autoMigrate: bool(env.AUTO_MIGRATE, client !== 'mssql'),
    logger: bool(env.LOG_HTTP, !isProd),
    redisUrl: env.REDIS_URL || undefined,
    instanceId: env.INSTANCE_ID || `app-${process.pid}`,
    ticketRatePerMinute: Number(env.TICKET_RATE_PER_MIN ?? 120),
    ticketRatePerDevice: Number(env.TICKET_RATE_PER_DEVICE ?? 30),
    trustProxy: /^\d+$/.test(env.TRUST_PROXY ?? '') ? Number(env.TRUST_PROXY) : bool(env.TRUST_PROXY, false),
    version,
    wsMaxClients: Number(env.WS_MAX_CLIENTS ?? 2000),
    wsMaxPerIp: Number(env.WS_MAX_PER_IP ?? 60),
  }
}
