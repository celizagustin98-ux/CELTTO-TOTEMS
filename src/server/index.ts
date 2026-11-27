import { buildApp } from './app.js'
import { purgeExpiredSessions } from './auth.js'
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
const sweep = async () => {
  try {
    const n = await closeStaleTickets(ctx)
    if (n) app.log.info(`${n} turnos de días anteriores cerrados`)
    const s = await purgeExpiredSessions(ctx)
    if (s) app.log.info(`${s} sesiones vencidas eliminadas`)
  } catch (e) {
    app.log.error(e)
  }
}
await sweep()
setInterval(sweep, 10 * 60_000).unref()
setInterval(() => ctx.hub.ping(), 30_000).unref()

await app.listen({ port: ctx.cfg.port, host: ctx.cfg.host })
console.log(`CELTTO-TOTEMS ${ctx.cfg.version} escuchando en http://${ctx.cfg.host}:${ctx.cfg.port} (${ctx.client}, hub ${ctx.hub.mode})`)
const stop = async () => {
  await app.close()
  await ctx.hub.close?.()
  await ctx.db.destroy()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
