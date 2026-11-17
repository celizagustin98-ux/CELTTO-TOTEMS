import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireRole, homeFor, useAuth } from './auth'
import { ToastProvider, Spinner } from './ui'
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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/master