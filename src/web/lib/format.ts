export function textOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#10202f' : '#ffffff'
}
export const fmtMin = (m: number | null | undefined) => (m === null || m === undefined ? '—' : m < 1 ? '<1 min' : `${Math.round(m)} min`)
export function elapsed(iso: string | null | undefined, now: number): string {
  if (!iso) return '00:00'
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
export const waitMin = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000))
export const clock = (d: Date | number) => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
export const longDate = (d: Date | number) => new Date(d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
export const hhmm = (iso: string | null) => (iso ? clock(new Date(iso)) : '—')
export const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const PALETTE = ['#2f6fed', '#0e9f6e', '#e8590c', '#c2255c', '#7048e8', '#0c8599', '#f59f00', '#e03131']

/** "hace 5 min", "hace 2 h" — para último acceso, estaciones, etc. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Nunca'
  const m = Math.floor((now - Date.parse(iso)) / 60000)
  if (m < 1) return 'Recién'
  if (m < 60) return `Hace ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `Hace ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'Ayer' : `Hace ${d} días`
}

/** Nivel de espera según los umbrales configurados: verde / amarillo / rojo. */
export function waitLevel(min: number, warn: number, danger: number): 'ok' | 'warn' | 'danger' {
  return min >= danger ? 'danger' : min >= warn ? 'warn' : 'ok'
}
