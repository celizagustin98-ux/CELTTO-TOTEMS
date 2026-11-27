import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, type Role, type User } from './lib/api'
import { Spinner } from './ui'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (u: string, p: string) => Promise<User>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)
export const useAuth = () => useContext(Ctx)

export const STAFF: Role[] = ['owner', 'admin', 'tech']
export const MANAGERS: Role[] = ['owner', 'admin']
export const ROLE_LABEL: Record<Role, string> = { owner: 'Dueño', admin: 'Administrador', tech: 'Técnico', secretary: 'Secretaria' }

/** Pantalla de inicio de cada rol. Debe coincidir con las rutas de App.tsx. */
export const homeFor = (u: User) => (STAFF.includes(u.role) ? '/master' : '/panel')

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = async () => {
    try {
      setUser(await api<User>('/api/auth/me'))
    } catch {
      setUser(null)
    }
  }
  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [])
  const login = async (username: string, password: string) => {
    const u = await api<User>('/api/auth/login', { body: { username, password } })
    setUser(u)
    return u
  }
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
  }
  return <Ctx.Provider value={{ user, loading, login, logout, refresh }}>{children}</Ctx.Provider>
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (!roles.includes(user.role)) {
    const home = homeFor(user)
    // Evita bucles: si ya estamos en la pantalla de inicio y no hay permiso, mostrar aviso en vez de redirigir
    if (loc.pathname.startsWith(home)) return <NoAccess />
    return <Navigate to={home} replace />
  }
  return <>{children}</>
}

function NoAccess() {
  const { logout } = useAuth()
  return (
    <div className="grid min-h-full place-items-center p-8 text-center">
      <div>
        <div className="display text-2xl font-semibold">Tu usuario no tiene acceso a esta pantalla</div>
        <p className="mt-2 text-muted">Pedile al administrador que revise tu rol.</p>
        <button onClick={logout} className="mt-5 rounded-lg bg-brand px-4 py-2 text-white">Cerrar sesión</button>
      </div>
    </div>
  )
}
