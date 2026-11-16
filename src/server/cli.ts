import { createInterface } from 'node:readline/promises'
import { DummyDriver, Kysely, MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler } from 'kysely'
import { insertId, nowIso } from './db.js'
import { migrations } from './migrations.js'
import { hashPassword } from './security.js'
import { saveSettings } from './settings.js'
import { createCtx, runMigrations } from './runtime.js'

const [cmd, ...args] = process.argv.slice(2)
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }

async function ask(q: string) { const rl = createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(q); rl.close(); return a.trim() }

async function main() {
  if (cmd === 'db:script') {
    
    const out: string[] = []
    const db = new Kysely<any>({
      dialect: { createAdapter: () => new MssqlAdapter(), createDriver: () => new DummyDriver(), createIntrospector: (d) => new MssqlIntrospector(d), createQueryCompiler: () => new MssqlQueryCompiler() },
      log: (e) => { if (e.level === 'query') out.push(e.query.sql) },
    })
    for (const m of Object.values(migrations)) await m.up(db)
    console.log('-- CELTTO-TOTEMS: esquema para SQL Server (generado desde las migraciones)\n-- Nota: "npm run migrate" aplica lo mismo y además registra la versión en kysely_migration.\n')
    console.log(out.map((s) => s + ';').join('\n\n'))
    return
  }

  const ctx = await createCtx()
  try {
    if (cmd === 'migrate') {
      const res = await runMigrations(ctx)
      console.log(res.length ? res.map((r) => `${r.status}: ${r.migrationName}`).join('\n') : 'La base ya está actualizada.')
    } else if (cmd === 'db:check') {
      const t0 = Date.now()
      await ctx.db.selectFrom('settings').select('setting_key').limit(1).execute()
      console.log(`Conexión OK (${ctx.client}) en ${Date.now() - t0} ms`)
      if (ctx.client === 'postgres') console.log(`PostgreSQL: ${ctx.cfg.postgres.host}:${ctx.cfg.postgres.port}  Base: ${ctx.cfg.postgres.database}`)
      if (ctx.client === 'mssql') console.log(`SQL Server: ${ctx.cfg.mssql.server}  Base: ${ctx.cfg.mssql.database}`)
      if (ctx.client === 'sqlite') console.log(`SQLite: ${ctx.cfg.sqlitePath}`)
    } else if (cmd === 'owner:create') {
      const username = (arg('user') ?? process.env.OWNER_USERNAME ?? (await ask('Usuario del dueño: '))).toLowerCase()
      const password = arg('pass') ?? process.env.OWNER_PASSWORD ?? (await ask('Contraseña (mínimo 8 caracteres): '))
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Usuario inválido (3 a 40 caracteres: letras, números, punto, guion)')
      if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres')
      const existing = await ctx.db.selectFrom('users').select(['id', 'role']).where('username', '=', username).executeTakeFirst()
      if (existing) {
        if (existing.role !== 'owner') throw new Error('Ese usuario ya existe y no es dueño')
        await ctx.db.updateTable('users').set({ password_hash: await hashPassword(password), active: 1 }).where('id', '=', existing.id).execute()
        console.log(`Contraseña del dueño "${username}" actualizada.`)
      } else {
        await insertId(ctx, ctx.db, 'users', { username, display_name: 'Dueño', password_hash: await hashPassword(password), role: 'owner', sector_id: null, desk: null, active: 1, created_at: nowIso() })
        console.log(`Dueño "${username}" creado.`)
      }
    } else if (cmd === 'seed:demo') {
      const mk = async (name: string, color: string, welcome: string, order: number) => insertId(ctx, ctx.db, 'sectors', { name, color, welcome_message: welcome, sort_order: order, active: 1, created_at: nowIso() })
      const a = await mk('Secretaría A', '#2F6FED', 'Bienvenido. Tocá una opción para sacar tu turno.', 1)
      const b = await mk('Secretaría B', '#0E9F6E', 'Bienvenido a Secretaría B.', 2)
      const btn = (sector: number, label: string, prefix: string, priority: number, order: number, subtitle?: string, target?: number) =>
        insertId(ctx, ctx.db, 'buttons', { sector_id: sector, target_sector_id: target ?? sector, label, subtitle: subtitle ?? null, color: null, prefix, priority, sort_order: order, active: 1 })
      await btn(a, 'Turno nuevo', 'A', 0, 1, 'Primera vez o nueva consulta')
      await btn(a, 'Continuar atención', 'C', 1, 2, 'Ya tengo un trámite iniciado')
      await btn(b, 'Retiro de resultados', 'R', 0, 1)
      await btn(b, 'Consulta general', 'B', 0, 2)
      for (const [u, n, s, d] of [['secretaria.a', 'Secretaria A', a, 'Box 1'], ['secretaria.b', 'Secretaria B', b, 'Box 2']] as const)
        await insertId(ctx, ctx.db, 'users', { username: u, display_name: n, password_hash: await hashPassword('demo12345'), role: 'secretary', sector_id: s, desk: d, active: 1, created_at: nowIso() })
      await saveSettings(ctx, {})
      console.log('Datos de demostración creados. Usuarios: secretaria.a / secretaria.b — contraseña: demo12345')
    } else {
      console.log('Comandos: migrate | owner:create [--user x --pass y] | seed:demo | db:check | db:script')
    }
  } finally { await ctx.db.destroy() }
}

main().catch((e) => { console.error('Error:', e.message ?? e); process.exit(1) })
