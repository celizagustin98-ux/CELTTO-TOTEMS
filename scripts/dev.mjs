// Entorno de desarrollo completo con un solo comando: `npm run dev`
//  1. Levanta un PostgreSQL local embebido (PGlite) en 127.0.0.1:5433 — no hace falta instalar PostgreSQL ni Docker.
//  2. Aplica migraciones, crea el usuario dueño y carga datos de demostración (solo la primera vez).
//  3. Arranca la API (tsx watch, puerto 8080) y la interfaz (Vite, puerto 5173).
// Las credenciales de prueba se guardan en .env.development.local (ignorado por git).
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const root = resolve(import.meta.dirname, '..')
const dataDir = resolve(root, 'data/pglite')
const envFile = resolve(root, '.env.development.local')
const PG_PORT = Number(process.env.DEV_PG_PORT ?? 5433)

function loadLocalEnv() {
  const out = {}
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) out[m[1]] = m[2]
    }
  }
  if (!out.DATA_KEY) {
    out.DATA_KEY = randomBytes(32).toString('base64url')
    // Clave de cifrado de desarrollo: se guarda para que los DNI cifrados se sigan leyendo entre reinicios
    const prev = existsSync(envFile) ? readFileSync(envFile, 'utf8').trimEnd() + '\n' : ''
    writeFileSync(envFile, `${prev}DATA_KEY=${out.DATA_KEY}\n`)
  }
  if (!out.OWNER_USERNAME || !out.OWNER_PASSWORD) {
    out.OWNER_USERNAME ||= 'dueno'
    out.OWNER_PASSWORD ||= `Dev-${randomBytes(6).toString('base64url')}`
    out.DEMO_PASSWORD ||= 'demo12345'
    writeFileSync(
      envFile,
      `# Credenciales de PRUEBA para npm run dev (no se suben a git)\nOWNER_USERNAME=${out.OWNER_USERNAME}\nOWNER_PASSWORD=${out.OWNER_PASSWORD}\nDEMO_PASSWORD=${out.DEMO_PASSWORD}\nDATA_KEY=${out.DATA_KEY}\n`,
    )
  }
  return out
}

mkdirSync(dataDir, { recursive: true })
const local = loadLocalEnv()
const db = await PGlite.create(dataDir)
const server = new PGLiteSocketServer({ db, port: PG_PORT, host: '127.0.0.1', maxConnections: 20 })
await server.start()
console.log(`[dev] PostgreSQL local (PGlite) en 127.0.0.1:${PG_PORT} — datos en data/pglite`)

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DB_CLIENT: 'postgres',
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: String(PG_PORT),
  POSTGRES_DATABASE: 'postgres',
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: 'postgres',
  PG_POOL_MAX: '4',
  PG_POOL_MIN: '0',
  REDIS_URL: '',
  COOKIE_SECURE: 'false',
  LOG_HTTP: 'false',
  AUTO_MIGRATE: 'true',
  ...local,
}

const tsx = resolve(root, 'node_modules/tsx/dist/cli.mjs')
const vite = resolve(root, 'node_modules/vite/bin/vite.js')
const node = process.execPath
// Asíncrono a propósito: el PostgreSQL embebido corre en este mismo proceso y necesita el event loop libre
const run = (args) =>
  new Promise((done) => spawn(node, [tsx, 'src/server/cli.ts', ...args], { cwd: root, env, stdio: 'inherit' }).on('exit', (code) => done(code ?? 1)))

if ((await run(['migrate'])) !== 0) process.exit(1)
await run(['owner:create', '--user', local.OWNER_USERNAME, '--pass', local.OWNER_PASSWORD])
await run(['seed:demo'])
console.log(`[dev] Usuario dueño: ${local.OWNER_USERNAME} (contraseña en .env.development.local)`)

const children = [
  spawn(node, [tsx, 'watch', '--clear-screen=false', 'src/server/index.ts'], { cwd: root, env, stdio: 'inherit' }),
  spawn(node, [vite, '--host', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' }),
]
const stop = async () => {
  for (const c of children) c.kill()
  await server.stop().catch(() => {})
  await db.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', (code) => code && code !== 0 && console.error(`[dev] un proceso terminó con código ${code}`))
