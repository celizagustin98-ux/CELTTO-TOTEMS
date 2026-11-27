import { Migrator } from 'kysely/migration'
import { loadConfig, type Config } from './config.js'
import { createDb, type Ctx } from './db.js'
import { createHub } from './hub.js'
import { migrations } from './migrations.js'

export async function createCtx(cfg: Config = loadConfig()): Promise<Ctx> {
  const { db, client } = await createDb(cfg)
  const hub = await createHub(cfg.redisUrl, { maxClients: cfg.wsMaxClients, maxPerIp: cfg.wsMaxPerIp })
  return { db, client, cfg, hub }
}

export const migrator = (ctx: Ctx) => new Migrator({ db: ctx.db, provider: { getMigrations: async () => migrations } })

export async function runMigrations(ctx: Ctx) {
  const { error, results } = await migrator(ctx).migrateToLatest()
  if (error) throw error
  return results ?? []
}
