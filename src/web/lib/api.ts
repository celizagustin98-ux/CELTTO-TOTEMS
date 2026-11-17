export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
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
  } catch { throw new ApiError(0, 'Sin conexión con el servidor') }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Ocurrió un error inesperado')
  return data as T
}

export interface User { id: number; username: string; displayName: string; role: 'owner' | 'secretary'; sectorId: number | null; desk: string | null }
export interface Btn { id: number; sectorId: number; targetSectorId: number; label: string; subtitle: string | null; color: string | null; prefix: string; priority: number; sortOrder: number }
export interface Sector { id: number; name: string; color: string; welcomeMessage: string | null; sortOrder: number; buttons: Btn[] }
export interface Settings {
  org_name: string
  tv_voice_enabled: boolean
  tv_chime_enabled: boolean
  tv_voice_template: string
  tv_voice_rate: number
  tv_chime_volume: number
  tv_history_size: number
  tv_media_enabled: boolean
  tv_media_urls: string
  tv_media_interval_sec: number
  totem_auto_print: boolean
  totem_pin: string
  totem_return_seconds: number
  totem_dni_enabled: boolean
  qr_ticket_enabled: boolean
  wait_estimate_enabled: boolean
  ticket_footer: string
  alert_queue_waiting: number
}
export interface Stats { total: number; waiting: number; active: number; done: number; absent: number; cancelled: number; avgWaitMin: number | null; avgServiceMin: number | null; oldestWaitingMin: number }
export interface CallTicket { id: number; code: string; prefix: string; number: number; desk: string | null; sectorId: number; sectorName: string; color: string; at: string | null }
