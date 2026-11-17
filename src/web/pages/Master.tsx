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
  const link = ({ isActive }: { isActive: boolean }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${isActive ? 'bg-white/12 text-white' : 'text-white/65 hover:bg-white/8 hover:text-white'}`
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col bg-ink p-4 text-white lg:sticky lg:top-0 lg:h-screen lg:w-64">
        <div className="display px-3 pb-4 pt-2 text-xl font-semibold tracking-tight">CELTTO-TOTEMS</div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Secciones">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={link}><n.icon size={18} /><span className="whitespace-nowrap">{t(n.labelKey)}</span></NavLink>)}
        </nav>
        <div className="mt-4 hidden border-t border-white/10 pt-4 lg:mt-auto lg:block">
          <a href="/totem" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/65 hover:text-white"><ExternalLink size={15} />{t('nav.openTotem')}</a>
          <a href="/tv" target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/65 hover:text-white"><ExternalLink size={15} />{t('nav.openTv')}</a>
          <div className="mb-2 px-1"><LanguageSwitcher className="text-white" /></div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-white/8 px-3 py-2.5">
            <div className="min-w-0"><div className="truncate text-sm font-medium">{user?.displayName}</div><div className="text-xs text-white/55">{t('nav.master')}</div></div>
            <button onClick={logout} aria-label="Cerrar sesión" className="rounded-md p-1.5 text-white/65 hover:bg-white/10 hover:text-white"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5 sm:p-8">
        <div className="mx-auto max-w-6xl">
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
