import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireRole, STAFF, homeFor, useAuth } from './auth'
import { ToastProvider, ConfirmProvider, Spinner } from './ui'
import Login from './pages/Login'
import Master from './pages/Master'
import Desk from './pages/Desk'
import Totem from './pages/Totem'
import Tv from './pages/Tv'
import TicketStatus from './pages/TicketStatus'

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
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/master/*" element={<RequireRole roles={STAFF}><Master /></RequireRole>} />
            <Route path="/panel" element={<RequireRole roles={['secretary']}><Desk /></RequireRole>} />
            <Route path="/desk" element={<Navigate to="/panel" replace />} />
            <Route path="/totem" element={<Totem />} />
            <Route path="/totem/:deviceKey" element={<Totem />} />
            <Route path="/tv" element={<Tv />} />
            <Route path="/tv/:deviceKey" element={<Tv />} />
            <Route path="/t/:code" element={<TicketStatus />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
