import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Armchair, BarChart3, ExternalLink, Flag, Layers, LayoutGrid, LogOut, Menu, Monitor, ScrollText, Settings as Cog, Users, X } from 'lucide-react'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Brand'
import { MANAGERS, ROLE_LABEL, useAuth } from '../auth'
import type { Role } from '../lib/api'
import { Avatar, ThemeToggle } from '../ui'
import Overview from './MasterOverview'
import Sectors from './MasterSectors'
import UsersPage from './MasterUsers'
import SettingsPage from './MasterSettings'
import Reports from './MasterReports'
import Priorities from './MasterPriorities'
import Stations from './MasterStations'
import Desks from './MasterDesks'
import Audit from './MasterAudit'

const ALL: Role[] = ['owner', 'admin', 'tech']
const NAV = [
  { to: '/master', end: true, labelKey: 'nav.overview', icon: LayoutGrid, roles: ALL },
  { to: '/master/secretarias', labelKey: 'nav.sectors', icon: Layers, roles: ALL },
  { to: '/master/prioridades', labelKey: 'nav.priorities', icon: Flag, roles: ALL },
  { to: '/master/escritorios', labelKey: 'nav.desks', icon: Armchair, roles: ALL },
  { to: '/master/estaciones', labelKey: 'nav.stations', icon: Monitor, roles: ALL },
  { to: '/master/usuarios', labelKey: 'nav.users', icon: Users, roles: MANAGERS },
  { to: '/master/reportes', labelKey: 'nav.reports', icon: BarChart3, roles: ALL },
  { to: '/master/configuracion', labelKey: 'nav.settings', icon: Cog, roles: MANAGERS },
  { to: '/master/auditoria', labelKey: 'nav.audit', icon: ScrollText, roles: MANAGERS },
]

export default function Master() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [loc.pathname])
  const role = user?.role ?? 'tech'
  const nav = NAV.filter((n) => n.roles.includes(role))
  const can = (path: string) => nav.some((n) => n.to === `/master/${path}`)
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
      isActive ? 'bg-white/10 text-white shadow-[inset_2px_0_0] shadow-teal-400' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`

  const Footer = (
    <div className="space-y-1 border-t border-white/5 p-3">
      <a href="/totem" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-slate-400 hover:bg-white/5 hover:text-slate-200">
        <ExternalLink size={13} /> {t('nav.openTotem')}
      </a>
      <a href="/tv" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-slate-400 hover:bg-white/5 hover:text-slate-200">
        <ExternalLink size={13} /> {t('nav.openTv')}
      </a>
      <div className="flex items-center justify-between px-1 pt-1 text-slate-400">
        <LanguageSwitcher />
        <ThemeToggle className="hover:bg-white/10 hover:text-white" />
      </div>
      <div className="mt-2 flex items-center gap-2.5 rounded-lg bg-white/5 px-2.5 py-2">
        <Avatar name={user?.displayName ?? '?'} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-slate-100">{user?.displayName}</div>
          <div className="text-[11px] text-slate-500">{ROLE_LABEL[role]}</div>
        </div>
        <button onClick={logout} aria-label={t('nav.logout')} title={t('nav.logout')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/* Barra superior en celular/tablet */}
      <div className="sticky top-0 z-40 flex items-center gap-3 bg-sidebar px-4 py-3 text-white lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-md p-1.5 hover:bg-white/10">
          <Menu size={20} />
        </button>
        <Logo className="h-7 w-7" rounded="rounded-lg" />
        <div className="text-[14px] font-semibold">{t('nav.master')}</div>
        <div className="ml-auto">
          <Avatar name={user?.displayName ?? '?'} size={28} />
        </div>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[16rem] flex-col bg-sidebar text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:border-r lg:border-white/5 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Logo className="h-8 w-8" rounded="rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold tracking-tight">CELTTO</div>
            <div className="truncate text-[11px] text-slate-500">Control de turnos</div>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5" aria-label="Secciones">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>
              <n.icon size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />
              <span className="whitespace-nowrap">{t(n.labelKey)}</span>
            </NavLink>
          ))}
        </nav>
        {Footer}
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="secretarias" element={<Sectors />} />
            <Route path="prioridades" element={<Priorities />} />
            <Route path="escritorios" element={<Desks />} />
            <Route path="estaciones" element={<Stations />} />
            <Route path="reportes" element={<Reports />} />
            {can('usuarios') && <Route path="usuarios" element={<UsersPage />} />}
            {can('configuracion') && <Route path="configuracion" element={<SettingsPage />} />}
            {can('auditoria') && <Route path="auditoria" element={<Audit />} />}
            <Route path="*" element={<Navigate to="/master" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
