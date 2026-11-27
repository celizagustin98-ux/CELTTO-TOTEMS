import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const h = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, h] = stored.split('$')
  if (alg !== 'scrypt' || !s || !h) return false
  const expected = Buffer.from(h, 'base64')
  const got = await scrypt(pw, Buffer.from(s, 'base64'), expected.length)
  return got.length === expected.length && timingSafeEqual(got, expected)
}

/** Hash fijo para comparar cuando el usuario no existe: iguala el tiempo de respuesta. */
let dummyHash: Promise<string> | null = null
export const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')))

/** Comparación de textos en tiempo constante (PIN, claves cortas). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb) && a.length === b.length
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

/** Contador mínimo que necesita el limitador (Redis o memoria). */
export interface CounterStore {
  incr(key: string, windowMs: number): Promise<number>
  reset(key: string): Promise<void>
}

export class MemoryCounterStore implements CounterStore {
  private hits = new Map<string, { n: number; until: number }>()
  async incr(key: string, windowMs: number) {
    const now = Date.now()
    const cur = this.hits.get(key)
    const entry = !cur || cur.until <= now ? { n: 0, until: now + windowMs } : cur
    entry.n++
    this.hits.set(key, entry)
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k)
    return entry.n
  }
  async reset(key: string) {
    this.hits.delete(key)
  }
}

/**
 * Limitador por ventana fija. Con Redis el conteo es compartido entre instancias
 * (docker compose --scale app=N); sin Redis queda en memoria del proceso.
 */
export class RateLimiter {
  constructor(private store: CounterStore, private prefix: string) {}
  async hit(key: string, max: number, windowMs: number): Promise<boolean> {
    try {
      return (await this.store.incr(`rl:${this.prefix}:${key}`, windowMs)) <= max
    } catch {
      return true
    }
  }
  async reset(key: string) {
    try { await this.store.reset(`rl:${this.prefix}:${key}`) } catch { /* sin conteo */ }
  }
}

/** Evita que un texto se interprete como fórmula al abrir el CSV en Excel/LibreOffice. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r;]/.test(s) || s !== String(v) ? `"${s.replace(/"/g, '""')}"` : s
}
