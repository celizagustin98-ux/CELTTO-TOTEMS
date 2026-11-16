import 'dotenv/config'
import { fileURLToPath } from 'node:url'

export type DbClient = 'postgres' | 'mssql' | 'sqlite'

export interface Config {
  port: number
  host: string
  client: DbClient
  postgres: {
    host: string
    port: number
    database: string
    user: string
    password: string
    ssl: boolean
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
  webDir: string
  autoMigrate: boolean
  logger: boolean
}

const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === '' ? d : ['1', 'true', 'yes', 'si'].includes(v.toLowerCase())

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = (env.DB_CLIENT ?? 'postgres').toLowerCase()
  const client: DbClient = raw === 'mssql' ? 'mssql' : raw === 'sqlite' ? 'sqlite' : 'postgres'
  const root = fileURLToPath(new URL('../..', import.meta.url))
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    client,
    postgres: {
      host: env.POSTGRES_HOST ?? env.PGHOST ?? 'localhost',
      port: Number(env.POSTGRES_PORT ?? env.PGPORT ?? 5432),
      database: env.POSTGRES_DATABASE ?? env.PGDATABASE ?? 'celtto_totems',
      user: env.POSTGRES_USER ?? env.PGUSER ?? 'celtto',
      password: env.POSTGRES_PASSWORD ?? env.PGPASSWORD ?? '',
      ssl: bool(env.POSTGRES_SSL, false),
    },
    mssql: {
      server: env.MSSQL_SERVER ?? 'localhost',
      port: Number(env.MSSQL_PORT ?? 1433),
      instance: env.MSSQL_INSTANCE || undefined,
      database: env.MSSQL_DATABASE ?? 'celtto_totems',
      user: env.MSSQL_USER ?? 'sa',
      password: env.MSSQL_PASSWORD ?? '',
      encrypt: bool(env.MSSQL_ENCRYPT, false),
      trustCert: bool(env.MSSQL_TRUST_CERT, true),
    },
    sqlitePath: env.SQLITE_PATH ?? `${root}data/celtto.db`,
    timezone: env.APP_TIMEZONE ?? 'America/Argentina/Cordoba',
    cookieSecure: bool(env.COOKIE_SECURE, false),
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    webDir: `${root}dist/web`,
    autoMigrate: bool(env.AUTO_MIGRATE, client !== 'mssql'),
    logger: bool(env.LOG_HTTP, true),
  }
}
