import { buildApp } from './app.js'
import { closeStaleTickets } from './queue.js'
import { createCtx, migrator, runMigrations } from './runtime.js'

const ctx = await createCtx()
try {
  if (ctx.cfg.autoMigrate) await runMigrations(ctx)
  else {
    const pending = (await migrator(ctx).getMigrations()).filter((m) => !m.executedAt)
    if (pending.length) throw new Error(`Faltan migraciones (${pending.length}). Ejecutá "npm run migrate" antes de iniciar.`)
  }
} catch (e) {
  console.error('No se pudo preparar la base de datos:', (e as Error).message)
  process.exit(1)
}

const app = await buildApp(ctx)
const sweep = () => closeStaleTickets(ctx).then((n) => n && app.log.info(`${n} turnos de días anteriores cerrados`)).catch((e) => app.log.error(e))
await sweep()
setInterval(sweep, 10 * 60_000).unref()
setInterval(() => ctx.hub.ping(), 30_000).unref()

await app.listen({ port: ctx.cfg.port, host: ctx.cfg.host })
const stop = async () => { await app.close(); await ctx.db.destroy(); process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
