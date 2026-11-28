// Diagnóstico: aplica las migraciones sobre un PostgreSQL embebido en memoria y muestra cada paso
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { loadConfig } from '../src/server/config.js'
import { createCtx, runMigrations } from '../src/server/runtime.js'

const port = 56000 + Math.floor(Math.random() * 1000)
const pg = await PGlite.create()
const srv = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1', maxConnections: 20 })
await srv.start()
const ctx = await createCtx(loadConfig({ DB_CLIENT: 'postgres', POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: String(port), POSTGRES_DATABASE: 'postgres', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'postgres', PG_POOL_MIN: '0' } as any))
const t0 = Date.now()
try {
  for (const r of await runMigrations(ctx)) console.log(r.status, r.migrationName, `${Date.now() - t0} ms`)
} catch (e) {
  console.error('FALLÓ:', (e as Error).message)
}
await ctx.db.destroy()
await srv.stop()
await pg.close()
process.exit(0)
