import type { Generated } from 'kysely'

export type TicketStatus = 'waiting' | 'called' | 'serving' | 'done' | 'absent' | 'cancelled'
export type UserRole = 'owner' | 'admin' | 'tech' | 'secretary'
export type StationKind = 'totem' | 'tv'

export interface Database {
  sectors: {
    id: Generated<number>
    name: string
    color: string
    welcome_message: string | null
    sort_order: number
    active: number
    created_at: string
  }
  buttons: {
    id: Generated<number>
    sector_id: number
    target_sector_id: number
    label: string
    subtitle: string | null
    color: string | null
    prefix: string
    priority_id: number | null
    priority: number
    sort_order: number
    active: number
  }
  priorities: {
    id: Generated<number>
    name: string
    weight: number
    color: string | null
    sort_order: number
    active: number
  }
  desks: {
    id: Generated<number>
    sector_id: number
    name: string
    code: string
    active: number
    sort_order: number
  }
  stations: {
    id: Generated<number>
    kind: StationKind
    name: string
    sector_id: number | null
    device_key: string
    active: number
    last_seen_at: string | null
    created_at: string
  }
  users: {
    id: Generated<number>
    username: string
    display_name: string
    password_hash: string
    role: UserRole
    sector_id: number | null
    desk_id: number | null
    desk: string | null
    active: number
    created_at: string
  }
  sessions: { token_hash: string; user_id: number; expires_at: string; created_at: string }
  tickets: {
    id: Generated<number>
    code: string
    prefix: string
    number: number
    business_date: string
    button_id: number
    sector_id: number
    origin_sector_id: number
    priority: number
    priority_id: number | null
    status: TicketStatus
    created_at: string
    called_at: string | null
    last_call_at: string | null
    started_at: string | null
    finished_at: string | null
    called_by: number | null
    desk: string | null
    desk_id: number | null
    recall_count: number
    print_count: number
  }
  counters: { counter_key: string; counter_value: number }
  ticket_events: {
    id: Generated<number>
    ticket_id: number
    type: string
    user_id: number | null
    data: string | null
    created_at: string
  }
  audit_log: {
    id: Generated<number>
    user_id: number | null
    action: string
    entity: string | null
    entity_id: string | null
    detail: string | null
    ip: string | null
    created_at: string
  }
  day_closes: {
    id: Generated<number>
    business_date: string
    closed_by: number | null
    notes: string | null
    snapshot: string | null
    created_at: string
  }
  settings: { setting_key: string; setting_value: string }
}

export interface AuthUser {
  id: number
  username: string
  displayName: string
  role: UserRole
  sectorId: number | null
  deskId: number | null
  desk: string | null
}
