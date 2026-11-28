import { buildApp } from './app.js'
import { purgeExpiredSessions } from './auth.js'
import { closeStaleTickets } from './queue.js'
import { applyRetention, encryptLegacyDocuments } from './patients.js'
import { migrateLegacyMedia } from './media.js'
import { archiveOld, ensureStats } from './stats.js'
import { startDbProbe } from './monitor.js'
import { getSettings } from './settings.js'
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

// Tareas de puesta al día de datos (idempotentes)
try {
  const enc = await encryptLegacyDocuments(ctx)
  if (enc.patients || enc.tickets) console.log(`Documentos cifrados: ${enc.patients} pacientes, ${enc.tickets} turnos sin DNI en claro`)
  const moved = await migrateLegacyMedia(ctx)
  if (moved) console.log(`${moved} imágenes de publicidad pasadas de la base a disco`)
} catch (e) {
  console.error('Error preparando datos:', (e as Error).message)
}

const app = await buildApp(ctx)
startDbProbe(ctx)
let lastDaily = ''
/** Una vez por día: resúmenes de días cerrados, archivo histórico y conservación de datos de pacientes. */
const daily = async () => {
  const day = new Date().toISOString().slice(0, 10)
  if (day === lastDaily) return
  lastDaily = day
  try {
    const s = await getSettings(ctx)
    const days = await ensureStats(ctx)
    const archived = await archiveOld(ctx, s.archive_after_months)
    const anon = await applyRetention(ctx, s.patient_retention_months)
    if (days || archived || anon) app.log.warn(`Mantenimiento: ${days} días resumidos, ${archived} turnos archivados, ${anon} pacientes anonimizados`)
  } catch (e) {
    app.log.error(e)
  }
}
const sweep = async () => {
  void daily()
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
