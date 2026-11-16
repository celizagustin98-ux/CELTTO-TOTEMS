import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { api, type User } from './lib/api'
import { Spinner } from './ui'

interface AuthCtx { user: User | null; loading: boolean; login: (u: string, p: string) => Promise<User>; logout: () => Promise<void> }
const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx)
export const useAuth = () => useContext(Ctx)
export const homeFor = (u: User) => (u.role === 'owner' ? '/master' : '/panel')

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { api<User>('/api/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false)) }, [])
  const login = async (username: string, password: string) => { const u = await api<User>('/api/auth/login', { body: { username, password } }); setUser(u); return u }
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null) }
  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}

export function RequireRole({ role, children }: { role: User['role']; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />
  return <>{children}</>
}
