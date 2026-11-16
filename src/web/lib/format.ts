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
export const clock = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
export const longDate = (d: Date) => d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
export const hhmm = (iso: string | null) => (iso ? clock(new Date(iso)) : '—')
export const todayStr = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const PRIORITY = [{ v: 0, label: 'Normal' }, { v: 1, label: 'Alta' }, { v: 2, label: 'Muy alta' }]
export const PALETTE = ['#2f6fed', '#0e9f6e', '#e8590c', '#c2255c', '#7048e8', '#0c8599', '#f59f00', '#e03131']
