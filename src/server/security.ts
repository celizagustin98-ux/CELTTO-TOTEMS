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

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
export const newToken = () => randomBytes(32).toString('base64url')

export class RateLimiter {
  private hits = new Map<string, number[]>()
  
  hit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now()
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (arr.length >= max) { this.hits.set(key, arr); return false }
    arr.push(now); this.hits.set(key, arr)
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k)
    return true
  }
}
