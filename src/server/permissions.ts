import type { Ctx } from './db.js'
import type { AuthUser, UserRole } from './types.js'

/**
 * Permisos del sistema. Cada rol tiene un conjunto fijo; el servidor valida SIEMPRE el permiso
 * (el panel solo oculta lo que no corresponde, pero no es la barrera de seguridad).
 */
export const PERMISSIONS = {
  'overview.view': 'Ver el resumen y los turnos del día',
  'reports.view': 'Ver estadísticas y productividad',
  'reports.export': 'Exportar reportes (CSV)',
  'tickets.cancel': 'Cancelar turnos',
  'day.close': 'Cerrar el día',
  'sectors.view': 'Ver secretarías, botones y puestos',
  'sectors.manage': 'Crear y editar secretarías y botones',
  'desks.manage': 'Crear y editar puestos',
  'priorities.manage': 'Configurar prioridades',
  'stations.manage': 'Administrar tótems y TVs',
  'media.manage': 'Cargar publicidad de la TV',
  'users.view': 'Ver usuarios',
  'users.manage': 'Crear y editar usuarios (secretarias, supervisores, técnicos, auditores)',
  'users.manage_admins': 'Crear y editar administradores',
  'ownership.transfer': 'Transferir el control maestro',
  'config.manage': 'Cambiar la configuración del sistema',
  'sites.manage': 'Administrar sedes',
  'audit.view': 'Ver la auditoría',
  'monitor.view': 'Ver el monitoreo del sistema',
  'desk.attend': 'Atender turnos desde el panel de secretaria',
} as const
export type Perm = keyof typeof PERMISSIONS

const ALL = Object.keys(PERMISSIONS) as Perm[]

export const ROLE_PERMS: Record<UserRole, Perm[]> = {
  /** Control maestro: único con control total, incluso sobre los administradores. */
  owner: ALL.filter((p) => p !== 'desk.attend'),
  /** Área de sistemas: configura todo, salvo administrar al dueño y a otros administradores. */
  admin: ALL.filter((p) => !['users.manage_admins', 'ownership.transfer', 'desk.attend'].includes(p)),
  /** Supervisor de área: ve y gestiona solo las secretarías que tiene asignadas. */
  supervisor: ['overview.view', 'reports.view', 'reports.export', 'tickets.cancel', 'sectors.view', 'users.view'],
  /** Soporte técnico: equipos y estado del sistema. */
  tech: ['overview.view', 'sectors.view', 'stations.manage', 'monitor.view'],
  /** Auditor / dirección: solo lectura de reportes y auditoría. */
  auditor: ['overview.view', 'reports.view', 'reports.export', 'sectors.view', 'audit.view'],
  /** Secretaria: atiende la cola de su secretaría. */
  secretary: ['desk.attend'],
}

export const ROLE_INFO: Record<UserRole, { label: string; description: string }> = {
  owner: { label: 'Control maestro', description: 'Control total del sistema. Administra a los administradores y puede transferir el control.' },
  admin: { label: 'Administrador', description: 'Área de sistemas: configura secretarías, tótems, TVs, usuarios y opciones.' },
  supervisor: { label: 'Supervisor de área', description: 'Ve las colas, reportes y productividad de sus secretarías; puede cancelar turnos.' },
  tech: { label: 'Técnico', description: 'Administra tótems y TVs y mira el monitoreo. No cambia configuración ni usuarios.' },
  auditor: { label: 'Auditor', description: 'Solo lectura: reportes, productividad y auditoría.' },
  secretary: { label: 'Secretaria', description: 'Atiende la cola de su secretaría desde el panel de atención.' },
}

export const can = (u: Pick<AuthUser, 'role'> | null | undefined, p: Perm) => !!u && ROLE_PERMS[u.role]?.includes(p)

/** Qué roles puede crear/editar cada rol. Nadie edita al control maestro (solo se transfiere). */
export function manageableRoles(actor: UserRole): UserRole[] {
  if (actor === 'owner') return ['admin', 'supervisor', 'tech', 'auditor', 'secretary']
  if (actor === 'admin') return ['supervisor', 'tech', 'auditor', 'secretary']
  return []
}

/**
 * Secretarías que puede ver un usuario. null = todas.
 * El supervisor ve solo las de su área (tabla user_sectors).
 */
export async function scopeSectors(ctx: Ctx, u: AuthUser): Promise<number[] | null> {
  if (u.role !== 'supervisor') return null
  const rows = await ctx.db.selectFrom('user_sectors').select('sector_id').where('user_id', '=', u.id).execute()
  return rows.map((r) => r.sector_id)
}
