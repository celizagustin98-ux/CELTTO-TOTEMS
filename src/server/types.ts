import type { Generated } from 'kysely'

export type TicketStatus = 'waiting' | 'called' | 'serving' | 'done' | 'absent' | 'cancelled'
export type UserRole = 'owner' | 'admin' | 'supervisor' | 'tech' | 'auditor' | 'secretary'
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
    site_id: number | null
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
    icon: string | null
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
    lang: string | null
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
    last_login_at: string | null
    created_at: string
    site_id: number | null
    totp_secret_enc: string | null
    totp_pending_enc: string | null
    totp_enabled: number
    totp_backup: string | null
    password_changed_at: string | null
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
    dni: string | null
    patient_id: number | null
    public_token: string | null
    offline_ref: string | null
    origin: string
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
  patients: {
    id: Generated<number>
    document_type: string
    document: string | null
    document_hash: string | null
    document_enc: string | null
    document_last4: string | null
    consent_at: string | null
    consent_version: string | null
    health_insurance: string | null
    insurance_number: string | null
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
    birth_date: string | null
    notes: string | null
    search_name: string
    visits: number
    last_visit_at: string | null
    source: string
    active: number
    created_at: string
    updated_at: string
  }
  assets: { asset_key: string; mime: string; data: string; updated_at: string }
  sites: { id: Generated<number>; name: string; code: string; address: string | null; timezone: string | null; active: number; created_at: string }
  user_sectors: { user_id: number; sector_id: number }
  auth_challenges: { token_hash: string; user_id: number; attempts: number; expires_at: string }
  daily_stats: {
    id: Generated<number>
    business_date: string
    site_id: number | null
    sector_id: number
    user_id: number
    issued: number
    called: number
    done: number
    absent: number
    cancelled: number
    transferred: number
    recalls: number
    wait_sum_sec: number
    wait_count: number
    wait_max_sec: number
    service_sum_sec: number
    service_count: number
    first_call_at: string | null
    last_finish_at: string | null
    computed_at: string
  }
  hourly_stats: { business_date: string; sector_id: number; hour: number; weekday: number; issued: number }
  tickets_archive: {
    id: number
    code: string
    business_date: string
    button_id: number
    sector_id: number
    origin_sector_id: number
    priority: number
    status: string
    created_at: string
    called_at: string | null
    started_at: string | null
    finished_at: string | null
    called_by: number | null
    desk: string | null
    recall_count: number
    patient_id: number | null
    archived_at: string
  }
  ticket_events_archive: { id: number; ticket_id: number; type: string; user_id: number | null; data: string | null; created_at: string }
  media: { id: Generated<number>; file_key: string; kind: string; mime: string; size_bytes: number; original_name: string | null; sort_order: number; active: number; created_at: string }
}

export interface AuthUser {
  id: number
  username: string
  displayName: string
  role: UserRole
  sectorId: number | null
  deskId: number | null
  desk: string | null
  mfaEnabled?: boolean
  siteId?: number | null
}
