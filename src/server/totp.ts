import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { sha256 } from './security.js'

/**
 * Doble factor con códigos de 6 dígitos que cambian cada 30 s (RFC 6238, compatible con
 * Google Authenticator, Microsoft Authenticator, Authy, 1Password, etc.).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function totpCode(secret: string, step = Math.floor(Date.now() / 30000)): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const off = h[h.length - 1] & 0xf
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

/** Acepta el código actual y uno antes/después (tolerancia de reloj de ±30 s). */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const now = Math.floor(Date.now() / 30000)
  for (const d of [-1, 0, 1]) {
    const a = Buffer.from(totpCode(secret, now + d))
    if (timingSafeEqual(a, Buffer.from(code))) return true
  }
  return false
}

export const otpauthUrl = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`

/** 8 códigos de respaldo de un solo uso (se guardan solo sus hashes). */
export function newBackupCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const r = randomBytes(5).toString('hex').toUpperCase()
    return `${r.slice(0, 5)}-${r.slice(5)}`
  })
  return { codes, hashes: codes.map((c) => sha256(c.replace('-', ''))) }
}

/** Consume un código de respaldo; devuelve la lista actualizada o null si no es válido. */
export function useBackupCode(stored: string | null, code: string): string[] | null {
  if (!stored) return null
  const list: string[] = JSON.parse(stored)
  const h = sha256(code.replace(/[^0-9A-Za-z]/g, '').toUpperCase())
  const i = list.indexOf(h)
  if (i < 0) return null
  list.splice(i, 1)
  return list
}
