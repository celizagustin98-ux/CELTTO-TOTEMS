import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { buildApp } from '../src/server/app.js'
import { loadConfig } from '../src/server/config.js'
import { insertId, nowIso } from '../src/server/db.js'
import { closeStaleTickets } from '../src/server/queue.js'
import { hashPassword } from '../src/server/security.js'
import { createCtx, runMigrations } from '../src/server/runtime.js'

let ctx: Awaited<ReturnType<typeof createCtx>>
let app: Awaited<ReturnType<typeof buildApp>>
let owner = '', secA = '', secA2 = '', secB = ''
let sectorA = 0, sectorB = 0, btnNew = 0, btnPrio = 0, btnB = 0

const call = async (method: string, url: string, cookie = '', body?: unknown) => {
  const res = await app.inject({ method: method as any, url, headers: cookie ? { cookie } : {}, payload: body as any })
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, cookie: (res.cookies[0] ? `sid=${res.cookies[0].value}` : '') }
}
const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', '', { username, password })).cookie

before(async () => {
  ctx = await createCtx({ ...loadConfig({ DB_CLIENT: 'sqlite', SQLITE_PATH: ':memory:', LOG_HTTP: 'false' } as any) })
  await runMigrations(ctx)
  await insertId(ctx, ctx.db, 'users', { username: 'dueno', display_name: 'Dueño', password_hash: await hashPassword('clave-dueno-1'), role: 'owner', sector_id: null, desk: null, active: 1, created_at: nowIso() })
  app = await buildApp(ctx)
  owner = await login('dueno', 'clave-dueno-1')
})
after(async () => { await app.close(); await ctx.db.destroy() })

describe('panel maestro', () => {
  test('solo el dueño entra al panel maestro', async () => {
    assert.equal((await call('GET', '/api/admin/sectors')).status, 401)
    assert.equal((await call('GET', '/api/admin/sectors', owner)).status, 200)
    assert.equal((await call('POST', '/api/auth/login', '', { username: 'dueno', password: 'mala' })).status, 401)
  })

  test('crea secretarías, botones y usuarios vinculados', async () => {
    sectorA = (await call('POST', '/api/admin/sectors', owner, { name: 'Secretaría A', color: '#2F6FED', welcomeMessage: 'Hola' })).body.id
    sectorB = (await call('POST', '/api/admin/sectors', owner, { name: 'Secretaría B', color: '#0E9F6E' })).body.id
    btnNew = (await call('POST', '/api/admin/buttons', owner, { sectorId: sectorA, label: 'Turno nuevo', prefix: 'a', priority: 0 })).body.id
    btnPrio = (await call('POST', '/api/admin/buttons', owner, { sectorId: sectorA, label: 'Continuar atención', prefix: 'C', priority: 1 })).body.id
    btnB = (await call('POST', '/api/admin/buttons', owner, { sectorId: sectorB, label: 'Resultados', prefix: 'R' })).body.id
    for (const [u, s, d] of [['sec.a', sectorA, 'Box 1'], ['sec.a2', sectorA, 'Box 2'], ['sec.b', sectorB, 'Box 3']] as const)
      assert.equal((await call('POST', '/api/admin/users', owner, { username: u, displayName: u, password: 'password123', sectorId: s, desk: d })).status, 200)
    secA = await login('sec.a', 'password123'); secA2 = await login('sec.a2', 'password123'); secB = await login('sec.b', 'password123')
    assert.ok(secA && secA2 && secB)
    assert.equal((await call('POST', '/api/admin/users', owner, { username: 'sec.a', displayName: 'x', password: 'password123', sectorId: sectorA })).status, 409)
    const sectors = (await call('GET', '/api/admin/sectors', owner)).body
    assert.equal(sectors[0].buttons[0].prefix, 'A')
  })

  test('una secretaria no puede entrar al panel maestro', async () => {
    assert.equal((await call('GET', '/api/admin/sectors', secA)).status, 403)
    assert.equal((await call('PUT', '/api/admin/settings', secA, { totem_pin: '1111' })).status, 403)
  })
})

describe('tótem y tickets', () => {
  test('lista pública solo muestra lo activo y no expone el PIN', async () => {
    const r = (await call('GET', '/api/public/sectors')).body
    assert.equal(r.sectors.length, 2)
    assert.equal('totem_pin' in r.settings, false)
  })

  test('numera por prefijo y día', async () => {
    const t1 = (await call('POST', '/api/public/tickets', '', { buttonId: btnNew })).body
    const t2 = (await call('POST', '/api/public/tickets', '', { buttonId: btnNew })).body
    assert.equal(t1.code, 'A-001'); assert.equal(t2.code, 'A-002'); assert.equal(t2.waitingAhead, 1)
    assert.equal((await call('POST', '/api/public/tickets', '', { buttonId: 99999 })).status, 404)
  })

  test('el botón prioritario pasa adelante en la cola', async () => {
    await call('POST', '/api/public/tickets', '', { buttonId: btnPrio })
    const st = (await call('GET', '/api/desk/state', secA)).body
    assert.equal(st.waiting[0].code, 'C-001')
    assert.deepEqual(st.waiting.map((w: any) => w.code), ['C-001', 'A-001', 'A-002'])
  })
})

describe('panel de secretaria', () => {
  test('solo ve la cola de su sector', async () => {
    await call('POST', '/api/public/tickets', '', { buttonId: btnB })
    assert.equal((await call('GET', '/api/desk/state', secB)).body.waiting.length, 1)
    assert.equal((await call('GET', '/api/desk/state', secA)).body.waiting.length, 3)
    assert.equal((await call('GET', '/api/desk/state')).status, 401)
    assert.equal((await call('GET', '/api/desk/state', owner)).status, 403)
  })

  test('dos puestos del mismo sector nunca toman el mismo turno', async () => {
    const [r1, r2] = await Promise.all([call('POST', '/api/desk/call-next', secA), call('POST', '/api/desk/call-next', secA2)])
    assert.equal(r1.status, 200); assert.equal(r2.status, 200)
    assert.notEqual(r1.body.current.code, r2.body.current.code)
  })

  test('flujo: no permite dos turnos a la vez, inicia, termina y registra', async () => {
    assert.equal((await call('POST', '/api/desk/call-next', secA)).status, 409)
    const rc = await call('POST', '/api/desk/recall', secA); assert.equal(rc.status, 200); assert.equal(rc.body.current.recallCount, 1)
    assert.equal((await call('POST', '/api/desk/start', secA)).body.current.status, 'serving')
    assert.equal((await call('POST', '/api/desk/recall', secA)).status, 409)
    const fin = await call('POST', '/api/desk/finish', secA)
    assert.equal(fin.body.current, null); assert.equal(fin.body.stats.done, 1)
  })

  test('ausente y derivar a otra secretaría', async () => {
    await call('POST', '/api/desk/call-next', secA)
    assert.equal((await call('POST', '/api/desk/absent', secA)).body.stats.absent, 1)
    await call('POST', '/api/desk/call-next', secA2)
    const tr = await call('POST', '/api/desk/transfer', secA2, { sectorId: sectorB })
    assert.equal(tr.status, 200); assert.equal(tr.body.current, null)
    assert.equal((await call('GET', '/api/desk/state', secB)).body.waiting.length, 2)
  })

  test('la pantalla de sala recibe el último llamado y las colas', async () => {
    const tv = (await call('GET', '/api/public/tv')).body
    assert.ok(tv.recent.length >= 1); assert.equal(tv.settings.tv_voice_enabled, true); assert.equal('totem_pin' in tv.settings, false)
  })
})

describe('configuración, reportes y cierre', () => {
  test('voz y sonido de la TV se pueden desactivar', async () => {
    const r = await call('PUT', '/api/admin/settings', owner, { tv_voice_enabled: false, tv_chime_enabled: true })
    assert.equal(r.body.tv_voice_enabled, false)
    assert.equal((await call('GET', '/api/public/tv')).body.settings.tv_voice_enabled, false)
    assert.equal((await call('PUT', '/api/admin/settings', owner, { totem_pin: 'abc' })).status, 400)
  })

  test('reporte y resumen', async () => {
    const ov = (await call('GET', '/api/admin/overview', owner)).body
    assert.equal(ov.sectors.length, 2)
    const rep = (await call('GET', '/api/admin/reports', owner)).body
    assert.ok(rep.totals.total >= 4 && rep.bySector.length === 2)
  })

  test('no se puede eliminar una secretaría con turnos en curso', async () => {
    assert.equal((await call('DELETE', `/api/admin/sectors/${sectorB}`, owner)).status, 409)
  })

  test('los turnos de días anteriores se cierran solos', async () => {
    await ctx.db.updateTable('tickets').set({ business_date: '2020-01-01' }).where('status', '=', 'waiting').execute()
    assert.ok((await closeStaleTickets(ctx)) > 0)
  })

  test('desactivar un usuario cierra su sesión', async () => {
    const users = (await call('GET', '/api/admin/users', owner)).body
    const id = users.find((u: any) => u.username === 'sec.b').id
    await call('PUT', `/api/admin/users/${id}`, owner, { active: false })
    assert.equal((await call('GET', '/api/desk/state', secB)).status, 401)
  })
})
