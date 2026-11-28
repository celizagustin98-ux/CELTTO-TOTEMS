import { createInterface } from 'node:readline/promises'
import { DummyDriver, Kysely, MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler } from 'kysely'
import { insertId, nowIso } from './db.js'
import { migrations } from './migrations.js'
import { hashPassword } from './security.js'
import { saveSettings } from './settings.js'
import { searchKey } from './patients.js'
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
        // Acceso de emergencia: nueva contraseña y se quita el doble factor (por si se perdió el celular)
        await ctx.db.updateTable('users').set({ password_hash: await hashPassword(password), active: 1, totp_enabled: 0, totp_secret_enc: null, totp_backup: null }).where('id', '=', existing.id).execute()
        await ctx.db.deleteFrom('sessions').where('user_id', '=', existing.id).execute()
        console.log(`Contraseña del dueño "${username}" actualizada y doble factor reiniciado.`)
      } else {
        await insertId(ctx, ctx.db, 'users', { username, display_name: 'Dueño', password_hash: await hashPassword(password), role: 'owner', sector_id: null, desk: null, active: 1, created_at: nowIso() })
        console.log(`Dueño "${username}" creado.`)
      }
    } else if (cmd === 'seed:demo') {
      if (await ctx.db.selectFrom('sectors').select('id').limit(1).executeTakeFirst()) {
        console.log('La base ya tiene secretarías: no se cargan datos de demostración.')
        return
      }
      const prio = await ctx.db.selectFrom('priorities').select(['id', 'weight', 'name']).orderBy('weight').execute()
      const mk = async (name: string, color: string, welcome: string, order: number) => insertId(ctx, ctx.db, 'sectors', { name, color, welcome_message: welcome, sort_order: order, active: 1, created_at: nowIso() })
      const a = await mk('Secretaría A', '#2f6fed', 'Bienvenido. Tocá una opción para sacar tu turno.', 1)
      const b = await mk('Secretaría B', '#0e9f6e', 'Bienvenido a Secretaría B.', 2)
      const btn = (sector: number, label: string, prefix: string, level: number, order: number, subtitle: string | null, icon: string) => {
        const p = prio[Math.min(level, prio.length - 1)]
        return insertId(ctx, ctx.db, 'buttons', { sector_id: sector, target_sector_id: sector, label, subtitle, color: null, icon, prefix, priority: p?.weight ?? 0, priority_id: p?.id ?? null, sort_order: order, active: 1 })
      }
      await btn(a, 'Turno nuevo', 'A', 0, 1, 'Primera vez o nueva consulta', 'ticket')
      await btn(a, 'Continuar atención', 'C', 0, 2, 'Ya tengo un trámite iniciado', 'repeat')
      await btn(a, 'Atención preferencial', 'P', 1, 3, 'Embarazadas, mayores y movilidad reducida', 'accessibility')
      await btn(b, 'Retiro de resultados', 'R', 0, 1, null, 'file-text')
      await btn(b, 'Consulta general', 'B', 0, 2, null, 'message-circle')
      const desks: Record<number, number[]> = {}
      for (const [sector, names] of [[a, ['Box 1', 'Box 2']], [b, ['Box 3']]] as const) {
        desks[sector] = []
        for (const [i, n] of names.entries()) desks[sector].push(await insertId(ctx, ctx.db, 'desks', { sector_id: sector, name: n, code: n.replace(' ', ''), active: 1, sort_order: i + 1 }))
      }
      const pass = process.env.DEMO_PASSWORD || 'demo12345'
      for (const [u, n, s, d, dn] of [['secretaria.a', 'Laura Gómez', a, desks[a][0], 'Box 1'], ['secretaria.b', 'Martín Pérez', b, desks[b][0], 'Box 3']] as const)
        await insertId(ctx, ctx.db, 'users', { username: u, display_name: n, password_hash: await hashPassword(pass), role: 'secretary', sector_id: s, desk: dn, desk_id: d, active: 1, created_at: nowIso() })
      for (const [doc, fn, ln] of [['30111222', 'María', 'González'], ['28999888', 'Juan Carlos', 'Fernández'], ['40123456', 'Lucía', 'Martínez']] as const)
        await insertId(ctx, ctx.db, 'patients', { document_type: 'DNI', document: null, document_hash: ctx.crypto.hash(doc), document_enc: ctx.crypto.encrypt(doc), document_last4: doc.slice(-4), first_name: fn, last_name: ln, phone: null, email: null, birth_date: null, notes: null, search_name: searchKey(fn, ln), consent_at: nowIso(), consent_version: 'demo', visits: 0, last_visit_at: null, source: 'panel', active: 1, created_at: nowIso(), updated_at: nowIso() })
      await saveSettings(ctx, { org_name: 'Centro Médico Demo' })
      console.log(`Datos de demostración creados. Usuarios: secretaria.a / secretaria.b — contraseña: ${pass}`)
    } else if (cmd === 'stats:rebuild') {
      const { persistDay } = await import('./stats.js')
      const from = arg('from')
      const to = arg('to') ?? from
      if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Uso: stats:rebuild --from AAAA-MM-DD [--to AAAA-MM-DD]')
      for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to!; d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10)
        console.log(`${day}: ${await persistDay(ctx, day)} filas`)
      }
    } else if (cmd === 'archive') {
      const { archiveOld } = await import('./stats.js')
      console.log(`${await archiveOld(ctx, Number(arg('months') ?? 13))} turnos archivados`)
    } else {
      console.log('Comandos: migrate | owner:create [--user x --pass y] | seed:demo | db:check | db:script | stats:rebuild --from AAAA-MM-DD [--to …] | archive [--months 13]')
    }
  } finally { await ctx.db.destroy() }
}

main().catch((e) => { console.error('Error:', e.message ?? e); process.exit(1) })
