import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireRole, STAFF, homeFor, useAuth } from './auth'
import { ToastProvider, ConfirmProvider, Spinner } from './ui'

// Carga dividida: cada pantalla se descarga solo cuando se usa (el tótem y la TV no bajan el panel maestro)
const Login = lazy(() => import('./pages/Login'))
const Master = lazy(() => import('./pages/Master'))
const Desk = lazy(() => import('./pages/Desk'))
const Totem = lazy(() => import('./pages/Totem'))
const Tv = lazy(() => import('./pages/Tv'))
const TicketStatus = lazy(() => import('./pages/TicketStatus'))
const Account = lazy(() => import('./pages/Account'))

function Home() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return <Navigate to={user ? homeFor(user) : '/login'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/master/*" element={<RequireRole roles={STAFF}><Master /></RequireRole>} />
              <Route path="/panel" element={<RequireRole roles={['secretary']}><Desk /></RequireRole>} />
              <Route path="/cuenta" element={<RequireRole roles={[...STAFF, 'secretary']}><Account /></RequireRole>} />
              <Route path="/desk" element={<Navigate to="/panel" replace />} />
              <Route path="/totem" element={<Totem />} />
              <Route path="/totem/:deviceKey" element={<Totem />} />
              <Route path="/tv" element={<Tv />} />
              <Route path="/tv/:deviceKey" element={<Tv />} />
              <Route path="/t/:token" element={<TicketStatus />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
