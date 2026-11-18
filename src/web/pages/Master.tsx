import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { BarChart3, ExternalLink, Layers, LayoutGrid, LogOut, Monitor, Settings as Cog, Users, Armchair, Flag } from 'lucide-react'
import { useAuth } from '../auth'
import Overview from './MasterOverview'
import Sectors from './MasterSectors'
import UsersPage from './MasterUsers'
import SettingsPage from './MasterSettings'
import Reports from './MasterReports'
import Priorities from './MasterPriorities'
import Stations from './MasterStations'
import Desks from './MasterDesks'

const NAV = [
  { to: '/master', end: true, labelKey: 'nav.overview', icon: LayoutGrid },
  { to: '/master/secretarias', labelKey: 'nav.sectors', icon: Layers },
  { to: '/master/prioridades', labelKey: 'nav.priorities', icon: Flag },
  { to: '/master/escritorios', labelKey: 'nav.desks', icon: Armchair },
  { to: '/master/estaciones', labelKey: 'nav.stations', icon: Monitor },
  { to: '/master/usuarios', labelKey: 'nav.users', icon: Users },
  { to: '/master/configuracion', labelKey: 'nav.settings', icon: Cog },
  { to: '/master/reportes', labelKey: 'nav.reports', icon: BarChart3 },
]

export default function Master() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
      isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
    }`

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-white/5 bg-sidebar text-white lg:sticky lg:top-0 lg:h-screen lg:w-[15.5rem] lg:border-b-0 lg:border-r lg:border-white/5">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-teal-600 text-[11px] font-bold tracking-tight">CT</div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-tight">CELTTO</div>
            <div className="truncate text-[11px] text-slate-500">Control de turnos</div>
          </div>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto px-2 pb-2 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:px-2.5" aria-label="Secciones">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={link}>
              <n.icon size={16} strokeWidth={1.75} className="shrink-0 opacity-80" />
              <span className="whitespace-nowrap">{t(n.labelKey)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="hidden space-y-1 border-t border-white/5 p-3 lg:block">
          <a href="/totem" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-slate-500 hover:bg-white/5 hover:text-slate-200">
            <ExternalLink size={13} /> {t('nav.openTotem')}
          </a>
          <a href="/tv" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12.5px] text-slate-500 hover:bg-white/5 hover:text-slate-200">
            <ExternalLink size={13} /> {t('nav.openTv')}
          </a>
          <div className="px-1 pt-1">
            <LanguageSwitcher className="text-slate-400" />
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-slate-100">{user?.displayName}</div>
              <div className="text-[11px] text-slate-500">{t('nav.master')}</div>
            </div>
            <button onClick={logout} aria-label="Cerrar sesión" className="rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-white">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="secretarias" element={<Sectors />} />
            <Route path="usuarios" element={<UsersPage />} />
            <Route path="configuracion" element={<SettingsPage />} />
            <Route path="reportes" element={<Reports />} />
            <Route path="prioridades" element={<Priorities />} />
            <Route path="escritorios" element={<Desks />} />
            <Route path="estaciones" element={<Stations />} />
            <Route path="*" element={<Navigate to="/master" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
