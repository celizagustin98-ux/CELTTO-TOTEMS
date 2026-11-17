import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { Kysely, MssqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely'
import type { Config, DbClient } from './config.js'
import type { Broadcaster } from './hub.js'
import type { Database } from './types.js'

export interface Ctx {
  db: Kysely<Database>
  client: DbClient
  cfg: Config
  hub: Broadcaster
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
      max: cfg.postgres.poolMax,
      min: cfg.postgres.poolMin,
      idleTimeoutMillis: cfg.postgres.idleTimeoutMs,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: false,
    })
    pool.on('error', (err) => {
      console.error('Postgres pool error', err.message)
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

/** Numeración atómica por clave (fecha|prefijo). En Postgres usa UPSERT. */
export async function nextCounterValue(ctx: Ctx, trx: Kysely<any>, key: string): Promise<number> {
  if (ctx.client === 'postgres') {
    const r = await sql<{ counter_value: number }>`
      INSERT INTO counters (counter_key, counter_value)
      VALUES (${key}, 1)
      ON CONFLICT (counter_key)
      DO UPDATE SET counter_value = counters.counter_value + 1
      RETURNING counter_value
    `.execute(trx)
    return Number(r.rows[0]?.counter_value ?? 1)
  }

  for (let i = 0; i < 5; i++) {
    const upd = await trx
      .updateTable('counters')
      .set((eb: any) => ({ counter_value: eb('counter_value', '+', 1) }))
      .where('counter_key', '=', key)
      .executeTakeFirst()
    if (Number(upd.numUpdatedRows) > 0) {
      const row = await trx
        .selectFrom('counters')
        .select('counter_value')
        .where('counter_key', '=', key)
        .executeTakeFirstOrThrow()
      return Number(row.counter_value)
    }
    try {
      await trx.insertInto('counters').values({ counter_key: key, counter_value: 1 }).execute()
      return 1
    } catch {
      /* carrera: reintentar */
    }
  }
  throw new Error('No se pudo asignar número de turno')
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
