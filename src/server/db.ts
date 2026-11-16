import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Kysely, MssqlDialect, PostgresDialect, SqliteDialect } from 'kysely'
import type { Config, DbClient } from './config.js'
import type { Hub } from './hub.js'
import type { Database } from './types.js'

export interface Ctx {
  db: Kysely<Database>
  client: DbClient
  cfg: Config
  hub: Hub
}

export async function createDb(cfg: Config): Promise<{ db: Kysely<Database>; client: DbClient }> {
  if (cfg.client === 'sqlite') {
    const { default: SQLite } = await import('better-sqlite3')
    if (cfg.sqlitePath !== ':memory:') mkdirSync(dirname(cfg.sqlitePath), { recursive: true })
    const database = new SQLite(cfg.sqlitePath)
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    return { db: new Kysely<Database>({ dialect: new SqliteDialect({ database }) }), client: 'sqlite' }
  }

  if (cfg.client === 'postgres') {
    const { default: pg } = await import('pg')
    const pool = new pg.Pool({
      host: cfg.postgres.host,
      port: cfg.postgres.port,
      database: cfg.postgres.database,
      user: cfg.postgres.user,
      password: cfg.postgres.password,
      ssl: cfg.postgres.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    })
    return { db: new Kysely<Database>({ dialect: new PostgresDialect({ pool }) }), client: 'postgres' }
  }

  
  const Tedious = await import('tedious')
  const Tarn = await import('tarn')
  const T = (Tedious as any).default ?? Tedious
  const m = cfg.mssql
  const dialect = new MssqlDialect({
    tarn: { ...Tarn, options: { min: 0, max: 10 } },
    tedious: {
      ...T,
      connectionFactory: () =>
        new T.Connection({
          server: m.server,
          authentication: { type: 'default', options: { userName: m.user, password: m.password } },
          options: {
            database: m.database,
            ...(m.instance ? { instanceName: m.instance } : { port: m.port }),
            encrypt: m.encrypt,
            trustServerCertificate: m.trustCert,
          },
        }),
    },
  })
  return { db: new Kysely<Database>({ dialect }), client: 'mssql' }
}

export async function insertId(
  ctx: Ctx,
  q: Kysely<any>,
  table: keyof Database,
  values: Record<string, unknown>,
): Promise<number> {
  const ins = q.insertInto(table as string).values(values as any)
  const row: any =
    ctx.client === 'mssql'
      ? await (ins as any).output('inserted.id').executeTakeFirstOrThrow()
      : await (ins as any).returning('id').executeTakeFirstOrThrow()
  return Number(row.id)
}

export const nowIso = () => new Date().toISOString()

export function businessDate(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}
