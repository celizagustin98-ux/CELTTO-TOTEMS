import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { buildApp } from '../src/server/app.js'
import { loadConfig } from '../src/server/config.js'
import { insertId, nowIso } from '../src/server/db.js'
import { closeStaleTickets } from '../src/server/queue.js'
import { hashPassword } from '../src/server/security.js'
import { createCtx, runMigrations } from '../src/server/runtime.js'
import { saveSettings } from '../src/server/settings.js'
import { totpCode } from '../src/server/totp.js'
import { persistDay } from '../src/server/stats.js'
import { businessDate } from '../src/server/db.js'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

// Carpeta compartida simulada (en producción es una carpeta de otro servidor montada en este)
const SHARE = join(tmpdir(), `celtto-test-share-${process.pid}`)
mkdirSync(join(SHARE, 'tv'), { recursive: true })
writeFileSync(join(SHARE, 'tv', '01-aviso.mp4'), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(100, 2)]))
writeFileSync(join(SHARE, 'tv', 'notas.txt'), 'no es multimedia')
writeFileSync(join(SHARE, 'secreto.mp4'), Buffer.from('fuera de la subcarpeta'))

// Los tests corren contra PostgreSQL real (PGlite embebido en memoria), el mismo motor que producción
const PG_PORT = 55432 + Math.floor(Math.random() * 1000)
let pg: PGlite
let pgServer: PGLiteSocketServer

let ctx: Awaited<ReturnType<typeof createCtx>>
let app: Awaited<ReturnType<typeof buildApp>>
let owner = '', secA = '', secA2 = '', secB = ''
let sectorA = 0, sectorB = 0, btnNew = 0, btnPrio = 0, btnB = 0

const call = async (method: string, url: string, cookie = '', body?: unknown, ip = '10.0.0.1') => {
  const res = await app.inject({ method: method as any, url, headers: cookie ? { cookie } : {}, payload: body as any, remoteAddress: ip })
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, cookie: (res.cookies[0] ? `sid=${res.cookies[0].value}` : '') }
}
const login = async (username: string, password: string) => (await call('POST', '/api/auth/login', '', { username, password })).cookie

before(async () => {
  pg = await PGlite.create()
  pgServer = new PGLiteSocketServer({ db: pg, port: PG_PORT, host: '127.0.0.1', maxConnections: 20 })
  await pgServer.start()
  ctx = await createCtx({
    ...loadConfig({ DB_CLIENT: 'postgres', POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: String(PG_PORT), POSTGRES_DATABASE: 'postgres', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'postgres', PG_POOL_MIN: '0', LOG_HTTP: 'false', TICKET_RATE_PER_MIN: '1000', MEDIA_DIR: join(tmpdir(), `celtto-test-media-${process.pid}`), MEDIA_SHARE_DIR: SHARE } as any),
  })
  await runMigrations(ctx)
  await insertId(ctx, ctx.db, 'users', { username: 'dueno', display_name: 'Dueño', password_hash: await hashPassword('clave-dueno-1'), role: 'owner', sector_id: null, desk: null, active: 1, created_at: nowIso() })
  // Los tests históricos emiten turnos sin identificar al paciente y con prioridades activas
  await saveSettings(ctx, { totem_patient_mode: 'off', priorities_enabled: true })
  app = await buildApp(ctx)
  owner = await login('dueno', 'clave-dueno-1')
})
after(async () => { await app.close(); await ctx.db.destroy(); await pgServer.stop(); await pg.close() })

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

describe('seguridad', () => {
  test('el health no expone detalles internos', async () => {
    const r = await call('GET', '/api/health')
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.body).sort(), ['dbLatencyMs', 'ok', 'version'])
  })

  test('cerrar sesión invalida el token en el servidor', async () => {
    const c = await login('dueno', 'clave-dueno-1')
    assert.equal((await call('GET', '/api/auth/me', c)).status, 200)
    await call('POST', '/api/auth/logout', c)
    assert.equal((await call('GET', '/api/auth/me', c)).status, 401)
  })

  test('bloquea la fuerza bruta del login', async () => {
    let last = 0
    for (let i = 0; i < 10; i++) last = (await call('POST', '/api/auth/login', '', { username: 'atacado', password: 'x' }, '10.9.9.9')).status
    assert.equal(last, 429)
  })

  test('bloquea la fuerza bruta del PIN al vincular estaciones', async () => {
    let last = 0
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/public/stations/bind', '', { kind: 'tv', deviceKey: 'abcdefgh12', sectorId: sectorA, pin: String(1000 + i) }, '10.8.8.8')).status
    assert.equal(last, 429)
  })

  test('el CSV neutraliza fórmulas', async () => {
    const id = (await call('POST', '/api/admin/sectors', owner, { name: '=HYPERLINK("x")', color: '#123456' })).body.id
    const b = (await call('POST', '/api/admin/buttons', owner, { sectorId: id, label: 'Test', prefix: 'Z' })).body.id
    await call('POST', '/api/public/tickets', '', { buttonId: b })
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats/export.csv', headers: { cookie: owner } })
    assert.match(res.body, /"'=HYPERLINK\(""x""\)"/)
  })

  test('el técnico ve el panel pero no cambia la configuración', async () => {
    assert.equal((await call('POST', '/api/admin/users', owner, { username: 'tecnico', displayName: 'Téc', password: 'password123', role: 'tech' })).status, 200)
    const tech = await login('tecnico', 'password123')
    assert.equal((await call('GET', '/api/admin/stations', tech)).status, 200)
    assert.equal((await call('PUT', '/api/admin/settings', tech, { org_name: 'x' })).status, 403)
    assert.equal((await call('GET', '/api/admin/users', tech)).status, 403)
  })

  test('cambiar la contraseña cierra las otras sesiones', async () => {
    await call('POST', '/api/admin/users', owner, { username: 'clave.test', displayName: 'Clave', password: 'password123', role: 'secretary', sectorId: sectorA })
    const s1 = await login('clave.test', 'password123')
    const s2 = await login('clave.test', 'password123')
    assert.equal((await call('PUT', '/api/auth/password', s1, { current: 'password123', next: 'nueva-clave-99' })).status, 200)
    assert.equal((await call('GET', '/api/auth/me', s1)).status, 200)
    assert.equal((await call('GET', '/api/auth/me', s2)).status, 401)
  })
})

describe('funcionalidad nueva', () => {
  test('la TV vinculada a una secretaría informa su filtro y la multimedia', async () => {
    await call('PUT', '/api/admin/settings', owner, { tv_media_enabled: true })
    assert.equal((await call('POST', '/api/admin/media/url', owner, { url: 'javascript:alert(1)' })).status, 400)
    assert.equal((await call('POST', '/api/admin/media/url', owner, { url: 'https://ejemplo.com/a.mp4', title: 'Aviso' })).status, 200)
    const st = (await call('POST', '/api/admin/stations', owner, { kind: 'tv', name: 'TV A', sectorId: sectorA })).body
    const tv = (await call('GET', `/api/public/tv?deviceKey=${st.deviceKey}`)).body
    assert.deepEqual(tv.sectorIds, [sectorA])
    assert.deepEqual(tv.settings.tv_media, [{ url: 'https://ejemplo.com/a.mp4', kind: 'video' }])
  })

  test('el estado público del turno calcula personas adelante', async () => {
    await call('POST', '/api/public/tickets', '', { buttonId: btnB })
    const t = (await call('POST', '/api/public/tickets', '', { buttonId: btnB })).body
    assert.match(t.qrPath, /^\/t\/[A-Za-z0-9_-]{16}$/)
    assert.equal((await call('GET', `/api/public/ticket/${t.code}`)).status, 400)
    const s = (await call('GET', `/api/public/ticket/${t.qrPath.slice(3)}`)).body
    assert.equal(s.status, 'waiting')
    assert.ok(s.waitingAhead >= 1)
  })
})

describe('pacientes', () => {
  test('con identificación obligatoria, el turno exige documento', async () => {
    await call('PUT', '/api/admin/settings', owner, { totem_patient_mode: 'required' })
    const r = await call('POST', '/api/public/tickets', '', { buttonId: btnB })
    assert.equal(r.status, 400)
  })

  test('documento desconocido: pide registro y después lo crea con nombre normalizado', async () => {
    assert.deepEqual((await call('POST', '/api/public/patients/lookup', '', { document: '30.555.444' })).body, { found: false })
    const sinDatos = await call('POST', '/api/public/tickets', '', { buttonId: btnB, patient: { document: '30555444' } })
    assert.equal(sinDatos.status, 409)
    assert.equal(sinDatos.body.error, 'patient_not_found')
    assert.equal((await call('POST', '/api/public/tickets', '', { buttonId: btnB, patient: { document: '30.555.444', firstName: 'juan', lastName: 'perez' } })).status, 400)
    const ok = await call('POST', '/api/public/tickets', '', { buttonId: btnB, patient: { document: '30.555.444', firstName: 'juan   pablo', lastName: 'PÉREZ', consent: true } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.patientName, 'Juan')
    const p = await ctx.db.selectFrom('patients').selectAll().where('document_hash', '=', ctx.crypto.hash('30555444')).executeTakeFirstOrThrow()
    assert.equal(p.document, null)
    assert.equal(ctx.crypto.decrypt(p.document_enc), '30555444')
    assert.equal(p.first_name, 'Juan Pablo')
    assert.equal(p.last_name, 'Pérez')
    assert.equal(p.visits, 1)
  })

  test('documento conocido: saludo abreviado y turno vinculado al paciente', async () => {
    const lk = (await call('POST', '/api/public/patients/lookup', '', { document: '30555444' })).body
    assert.deepEqual(lk, { found: true, greeting: 'Juan P.' })
    const t = (await call('POST', '/api/public/tickets', '', { buttonId: btnB, patient: { document: '30555444' } })).body
    const row = await ctx.db.selectFrom('tickets').select(['patient_id', 'dni']).where('id', '=', t.id).executeTakeFirstOrThrow()
    assert.ok(row.patient_id)
    assert.equal(row.dni, null)
    const p = await ctx.db.selectFrom('patients').select('visits').where('id', '=', row.patient_id!).executeTakeFirstOrThrow()
    assert.equal(p.visits, 2)
  })

  test('la secretaria ve el nombre del paciente en la cola', async () => {
    await call('POST', '/api/admin/users', owner, { username: 'sec.b2', displayName: 'B2', password: 'password123', role: 'secretary', sectorId: sectorB })
    const st = (await call('GET', '/api/desk/state', await login('sec.b2', 'password123'))).body
    assert.ok(st.waiting.some((w: any) => w.patientName === 'Juan Pablo Pérez'))
  })

  test('rechaza documentos y nombres inválidos', async () => {
    assert.equal((await call('POST', '/api/public/patients/lookup', '', { document: '12' })).status, 400)
    assert.equal((await call('POST', '/api/public/tickets', '', { buttonId: btnB, patient: { document: '40111222', firstName: '<script>', lastName: 'X1' } })).status, 400)
  })
})

describe('prioridades opcionales', () => {
  test('con prioridades apagadas, el tótem no muestra ni acepta botones prioritarios', async () => {
    await call('PUT', '/api/admin/settings', owner, { priorities_enabled: false, totem_patient_mode: 'off' })
    const pub = (await call('GET', '/api/public/sectors')).body
    const all = pub.sectors.flatMap((s: any) => s.buttons)
    assert.ok(!all.some((b: any) => b.id === btnPrio))
    assert.equal((await call('POST', '/api/public/tickets', '', { buttonId: btnPrio })).status, 404)
  })
})

describe('roles y permisos', () => {
  let supA = ''
  test('el supervisor ve solo su área y no configura', async () => {
    assert.equal((await call('POST', '/api/admin/users', owner, { username: 'super.a', displayName: 'Supervisora A', password: 'password123', role: 'supervisor', areaSectorIds: [sectorA] })).status, 200)
    supA = await login('super.a', 'password123')
    const ov = (await call('GET', '/api/admin/overview', supA)).body
    assert.deepEqual(ov.sectors.map((s: any) => s.id), [sectorA])
    assert.equal((await call('PUT', '/api/admin/settings', supA, { org_name: 'x' })).status, 403)
    assert.equal((await call('POST', '/api/admin/sectors', supA, { name: 'X', color: '#111111' })).status, 403)
    const users = (await call('GET', '/api/admin/users', supA)).body
    assert.ok(users.every((u: any) => u.role === 'secretary' && u.sectorId === sectorA))
  })

  test('el supervisor no puede cancelar turnos de otra área', async () => {
    const t = (await call('POST', '/api/public/tickets', '', { buttonId: btnB })).body
    assert.equal((await call('POST', `/api/admin/tickets/${t.id}/cancel`, supA)).status, 403)
  })

  test('el auditor solo lee', async () => {
    await call('POST', '/api/admin/users', owner, { username: 'auditor', displayName: 'Auditor', password: 'password123', role: 'auditor' })
    const au = await login('auditor', 'password123')
    assert.equal((await call('GET', '/api/admin/audit', au)).status, 200)
    assert.equal((await call('GET', '/api/admin/productivity', au)).status, 200)
    assert.equal((await call('POST', '/api/admin/day-close', au, {})).status, 403)
  })

  test('un administrador no puede crear administradores; el control maestro sí', async () => {
    assert.equal((await call('POST', '/api/admin/users', owner, { username: 'admin.sis', displayName: 'Sistemas', password: 'password123', role: 'admin' })).status, 200)
    const adm = await login('admin.sis', 'password123')
    assert.equal((await call('POST', '/api/admin/users', adm, { username: 'admin.2', displayName: 'Otro', password: 'password123', role: 'admin' })).status, 403)
    assert.equal((await call('POST', '/api/admin/users', adm, { username: 'sec.nueva', displayName: 'Nueva', password: 'password123', role: 'secretary', sectorId: sectorA })).status, 200)
  })
})

describe('doble factor', () => {
  test('activar, pedir el código al entrar y aceptar códigos de respaldo', async () => {
    await call('POST', '/api/admin/users', owner, { username: 'mfa.user', displayName: 'MFA', password: 'password123', role: 'tech' })
    const c = await login('mfa.user', 'password123')
    const setup = (await call('POST', '/api/auth/mfa/setup', c)).body
    assert.match(setup.otpauth, /^otpauth:\/\/totp\//)
    assert.equal((await call('POST', '/api/auth/mfa/enable', c, { code: '000000' })).status, 400)
    const en = (await call('POST', '/api/auth/mfa/enable', c, { code: totpCode(setup.secret) })).body
    assert.equal(en.backupCodes.length, 8)
    const step1 = (await call('POST', '/api/auth/login', '', { username: 'mfa.user', password: 'password123' })).body
    assert.equal(step1.mfaRequired, true)
    assert.equal((await call('POST', '/api/auth/mfa', '', { challenge: step1.challenge, code: '123456' })).status, 401)
    const ok = await call('POST', '/api/auth/mfa', '', { challenge: step1.challenge, code: totpCode(setup.secret) })
    assert.equal(ok.status, 200)
    const step2 = (await call('POST', '/api/auth/login', '', { username: 'mfa.user', password: 'password123' })).body
    assert.equal((await call('POST', '/api/auth/mfa', '', { challenge: step2.challenge, code: en.backupCodes[0] })).status, 200)
    const step3 = (await call('POST', '/api/auth/login', '', { username: 'mfa.user', password: 'password123' })).body
    assert.equal((await call('POST', '/api/auth/mfa', '', { challenge: step3.challenge, code: en.backupCodes[0] })).status, 401)
  })

  test('si el rol exige doble factor, sin activarlo no puede operar', async () => {
    await call('PUT', '/api/admin/settings', owner, { mfa_required_roles: ['auditor'] })
    const au = await login('auditor', 'password123')
    const r = await call('GET', '/api/admin/audit', au)
    assert.equal(r.status, 403)
    assert.equal(r.body.error, 'mfa_setup_required')
    assert.equal((await call('GET', '/api/auth/me', au)).body.mfaSetupRequired, true)
    await call('PUT', '/api/admin/settings', owner, { mfa_required_roles: [] })
  })
})

describe('multimedia', () => {
  test('por dirección: sin extensión pide indicar el tipo; no se guarda nada en el servidor', async () => {
    assert.equal((await call('POST', '/api/admin/media/url', owner, { url: 'http://192.168.1.20/publicidad/aviso' })).status, 400)
    const r = await call('POST', '/api/admin/media/url', owner, { url: 'http://192.168.1.20/publicidad/aviso', kind: 'video' })
    assert.equal(r.status, 200)
    const list = (await call('GET', '/api/admin/media', owner)).body
    assert.ok(list.items.some((m: any) => m.source === 'url' && m.url === 'http://192.168.1.20/publicidad/aviso' && m.kind === 'video'))
  })

  test('la subida al servidor está desactivada por defecto y se puede habilitar', async () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(200, 1)])
    const off = await app.inject({ method: 'POST', url: '/api/admin/media?name=aviso.mp4', headers: { cookie: owner, 'content-type': 'video/mp4' }, payload: mp4 })
    assert.equal(off.statusCode, 403)
    await call('PUT', '/api/admin/settings', owner, { media_upload_enabled: true })
    const up = await app.inject({ method: 'POST', url: '/api/admin/media?name=aviso.mp4', headers: { cookie: owner, 'content-type': 'video/mp4' }, payload: mp4 })
    assert.equal(up.statusCode, 200)
    const { url } = JSON.parse(up.body)
    const part = await app.inject({ method: 'GET', url, headers: { range: 'bytes=0-9' } })
    assert.equal(part.statusCode, 206)
    assert.equal(part.rawPayload.length, 10)
    const fake = await app.inject({ method: 'POST', url: '/api/admin/media', headers: { cookie: owner, 'content-type': 'video/mp4' }, payload: Buffer.from('esto no es un video') })
    assert.equal(fake.statusCode, 400)
  })

  test('carpeta compartida: reproduce sus archivos sin copiarlos y no deja salir de la carpeta', async () => {
    await call('PUT', '/api/admin/settings', owner, { media_share_enabled: true, media_share_subdir: 'tv' })
    const m = (await call('GET', '/api/admin/media?refresh=1', owner)).body
    assert.equal(m.share.configured, true)
    assert.deepEqual(m.share.files.map((f: any) => f.name), ['01-aviso.mp4'])
    const tv = (await call('GET', '/api/public/tv')).body
    const shared = tv.settings.tv_media.find((x: any) => x.url.startsWith('/api/public/share/'))
    assert.ok(shared && shared.kind === 'video')
    const file = await app.inject({ method: 'GET', url: shared.url, headers: { range: 'bytes=4-7' } })
    assert.equal(file.statusCode, 206)
    assert.equal(file.rawPayload.toString('ascii'), 'ftyp')
    assert.equal((await app.inject({ method: 'GET', url: '/api/public/share/..%2Fsecreto.mp4' })).statusCode, 404)
    assert.equal((await app.inject({ method: 'GET', url: '/api/public/share/notas.txt' })).statusCode, 404)
    assert.equal((await call('PUT', '/api/admin/settings', owner, { media_share_subdir: '../' })).status, 400)
  })
})

describe('productividad y sin conexión', () => {
  test('resumen diario y productividad por usuario', async () => {
    const today = businessDate(ctx.cfg.timezone)
    assert.ok((await persistDay(ctx, today)) > 0)
    const p = (await call('GET', `/api/admin/productivity?from=${today}&to=${today}`, owner)).body
    assert.ok(p.totals.issued > 0)
    assert.ok(Array.isArray(p.users) && Array.isArray(p.sectors))
    assert.equal(p.heatmap.length, 7)
  })

  test('sincroniza turnos emitidos sin conexión sin duplicarlos', async () => {
    await call('PUT', '/api/admin/settings', owner, { totem_patient_mode: 'off' })
    const body = { deviceKey: 'totem-offline-1', tickets: [{ ref: 'offline-ref-0001', buttonId: btnB, code: 'R-T9-001', createdAt: new Date(Date.now() - 60_000).toISOString() }] }
    const r1 = (await call('POST', '/api/public/tickets/offline-sync', '', body)).body
    assert.equal(r1.results[0].ok, true)
    const r2 = (await call('POST', '/api/public/tickets/offline-sync', '', body)).body
    assert.equal(r2.results[0].code, r1.results[0].code)
    const n = await ctx.db.selectFrom('tickets').select('id').where('offline_ref', '=', 'offline-ref-0001').execute()
    assert.equal(n.length, 1)
  })
})
