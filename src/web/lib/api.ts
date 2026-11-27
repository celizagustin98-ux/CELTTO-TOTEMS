export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T = any>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const hasBody = opts?.body !== undefined
  let res: Response
  try {
    res = await fetch(path, {
      method: opts?.method ?? (hasBody ? 'POST' : 'GET'),
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(opts!.body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Ocurrió un error inesperado')
  return data as T
}

export type Role = 'owner' | 'admin' | 'tech' | 'secretary'
export interface User { id: number; username: string; displayName: string; role: Role; sectorId: number | null; deskId: number | null; desk: string | null }
export interface Btn { id: number; sectorId: number; targetSectorId: number; label: string; subtitle: string | null; color: string | null; icon: string | null; prefix: string; priority: number; priorityId: number | null; sortOrder: number }
export interface Sector { id: number; name: string; color: string; welcomeMessage: string | null; sortOrder: number; buttons: Btn[] }
export interface Priority { id: number; name: string; weight: number; color: string | null; sort_order: number; active: boolean }
export interface Settings {
  org_name: string
  brand_color: string
  tv_voice_enabled: boolean
  tv_chime_enabled: boolean
  tv_voice_template: string
  tv_voice_rate: number
  tv_chime_volume: number
  tv_history_size: number
  tv_media_enabled: boolean
  tv_media_urls: string
  tv_media_interval_sec: number
  tv_layout: 'split' | 'media' | 'calls'
  tv_ticker: string
  totem_auto_print: boolean
  totem_pin: string
  totem_return_seconds: number
  totem_dni_enabled: boolean
  totem_idle_enabled: boolean
  totem_idle_seconds: number
  qr_ticket_enabled: boolean
  wait_estimate_enabled: boolean
  wait_warn_min: number
  wait_danger_min: number
  ticket_footer: string
  alert_queue_waiting: number
}
export interface Stats { total: number; waiting: number; active: number; done: number; absent: number; cancelled: number; avgWaitMin: number | null; avgServiceMin: number | null; oldestWaitingMin: number }
export interface CallTicket { id: number; code: string; prefix: string; number: number; desk: string | null; sectorId: number; sectorName: string; color: string; at: string | null }
