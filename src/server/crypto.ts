import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

/**
 * Cifrado de datos personales (DNI, secretos de doble factor).
 * - AES-256-GCM para guardar el dato y poder mostrarlo a personal autorizado.
 * - HMAC-SHA256 para buscar por documento sin guardarlo en claro (mismo DNI → mismo hash).
 * Las dos claves se derivan de DATA_KEY. Si se pierde DATA_KEY, los datos cifrados no se recuperan:
 * guardala junto con los respaldos, en un lugar seguro.
 */
export class DataCrypto {
  private encKey: Buffer
  private macKey: Buffer
  constructor(master: string) {
    const root = createHash('sha256').update(master).digest()
    this.encKey = createHmac('sha256', root).update('celtto:enc:v1').digest()
    this.macKey = createHmac('sha256', root).update('celtto:mac:v1').digest()
  }

  /** Formato: v1.<iv>.<tag>.<datos> en base64url. */
  encrypt(plain: string): string {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.encKey, iv)
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
  }

  decrypt(token: string | null | undefined): string | null {
    if (!token) return null
    const [v, iv, tag, data] = token.split('.')
    if (v !== 'v1' || !iv || !tag || !data) return null
    try {
      const d = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(iv, 'base64url'))
      d.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  /** Hash determinístico para buscar (no reversible). */
  hash(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('hex')
  }
}

/** Muestra solo los últimos dígitos: "•••• 3456". */
export const maskDocument = (last4: string | null | undefined) => (last4 ? `•••• ${last4}` : '—')
