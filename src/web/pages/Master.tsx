import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Armchair, BarChart3, ChevronRight, ExternalLink, Flag, Layers, LayoutGrid, LogOut, Menu, Monitor, ScrollText, Search,
  Settings as Cog, Users, X, Command, Activity, Building2, UserCog, Clapperboard, Bell, PanelLeftClose, PanelLeftOpen, ChevronDown, Moon, Sun, MonitorOff, AlertTriangle, KeyRound as KeyIcon,
} from 'lucide-react'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Brand'
import { ROLE_LABEL, can, useAuth } from '../auth'
import { api } from '../lib/api'
import { useLive } from '../lib/live'
import { Avatar, ThemeToggle, useTheme } from '../ui'
import Overview from './MasterOverview'
import Sectors from './MasterSectors'
import UsersPage from './MasterUsers'
import SettingsPage from './MasterSettings'
import Reports from './MasterReports'
import Priorities from './MasterPriorities'
import Stations from './MasterStations'
import Desks from './MasterDesks'
import Audit from './MasterAudit'
import MonitorPage from './MasterMonitor'
import Sites from './MasterSites'
import MediaPage from './MasterMedia'

type NavItem = { to: string; end?: boolean; labelKey: string; icon: typeof LayoutGrid; perm: string; hint: string; needsPriorities?: boolean }
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operación',
    items: [
      { to: '/master', end: true, labelKey: 'nav.overview', icon: LayoutGrid, perm: 'overview.view', hint: 'Colas en vivo, alertas y turnos de hoy' },
      { to: '/master/reportes', labelKey: 'nav.reports', icon: BarChart3, perm: 'reports.view', hint: 'Productividad, tiempos y mapa de demanda' },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { to: '/master/secretarias', labelKey: 'nav.sectors', icon: Layers, perm: 'sectors.view', hint: 'Colas y botones del tótem' },
      { to: '/master/escritorios', labelKey: 'nav.desks', icon: Armchair, perm: 'sectors.view', hint: 'Boxes y ventanillas' },
      { to: '/master/estaciones', labelKey: 'nav.stations', icon: Monitor, perm: 'stations.manage', hint: 'Direcciones fijas de tótems y TVs' },
      { to: '/master/publicidad', labelKey: 'nav.media', icon: Clapperboard, perm: 'media.manage', hint: 'Imágenes y videos de la TV' },
      { to: '/master/prioridades', labelKey: 'nav.priorities', icon: Flag, perm: 'sectors.view', hint: 'Atención preferencial', needsPriorities: true },
      { to: '/master/sedes', labelKey: 'nav.sites', icon: Building2, perm: 'sites.manage', hint: 'Sedes de la institución' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { to: '/master/usuarios', labelKey: 'nav.users', icon: Users, perm: 'users.view', hint: 'Roles, permisos y doble factor' },
      { to: '/master/configuracion', labelKey: 'nav.settings', icon: Cog, perm: 'config.manage', hint: 'Marca, tótem, TV, publicidad y seguridad' },
      { to: '/master/monitoreo', labelKey: 'nav.monitor', icon: Activity, perm: 'monitor.view', hint: 'Estado del sistema, equipos y respaldos' },
      { to: '/master/auditoria', labelKey: 'nav.audit', icon: ScrollText, perm: 'audit.view', hint: 'Accesos y cambios' },
    ],
  },
]

export default function Master() {
  const { t } = useTranslation()
  const { user, logout } = useAuth()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [palette, setPalette] = useState(false)
  const [prioritiesOn, setPrioritiesOn] = useState(false)
  const [logoVersion, setLogoVersion] = useState<string | null | undefined>(undefined)
  const [org, setOrg] = useState('')
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('celtto.nav.collapsed') === '1' } catch { return false } })
  const [alerts, setAlerts] = useState<{ type: string; sectorName?: string; waiting?: number; name?: string; kind?: string; lastSeenAt?: string }[]>([])
  const [menu, setMenu] = useState<'bell' | 'user' | null>(null)
  const { dark, toggle } = useTheme()
  const loadAlerts = () => (can(user, 'overview.view') ? api<{ alerts: typeof alerts }>('/api/admin/ops-alerts').then((d) => setAlerts(d.alerts)).catch(() => {}) : Promise.resolve())
  useEffect(() => {
    void loadAlerts()
    const id = setInterval(loadAlerts, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try { localStorage.setItem('celtto.nav.collapsed', collapsed ? '1' : '0') } catch { /* sin almacenamiento */ }
  }, [collapsed])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])
  const loadBrand = () =>
    api<{ settings: { priorities_enabled: boolean; org_name: string }; logoVersion: string | null }>('/api/public/sectors')
      .then((d) => {
        setPrioritiesOn(d.settings.priorities_enabled)
        setLogoVersion(d.logoVersion)
        setOrg(d.settings.org_name)
      })
      .catch(() => {})
  useEffect(() => {
    void loadBrand()
  }, [])
  useLive((m) => {
    if (m.type === 'config') void loadBrand()
    if (m.type === 'queue') void loadAlerts()
  })
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const role = user?.role ?? 'tech'
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => can(user, n.perm) && (!n.needsPriorities || prioritiesOn)) })).filter((g) => g.items.length)
  const flat = groups.flatMap((g) => g.items)
  const allowed = (path: string) => flat.some((n) => n.to === `/master/${path}`)
  const current = [...flat].sort((a, b) => b.to.length - a.to.length).find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))

  const link = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-2.5 rounded-lg py-2 text-[13.5px] font-medium transition-colors ${collapsed ? 'lg:justify-center lg:px-0 px-2.5' : 'px-2.5'} ${
      isActive ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
    }`
  const visibleAlerts = alerts.filter((a) => a.type !== 'default_pin' || can(user, 'config.manage'))

  return (
    <div className="flex min-h-full bg-mesh">
      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[16.5rem] flex-col bg-sidebar text-white transition-[transform,width] duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${collapsed ? 'lg:w-[4.5rem]' : ''} ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-3 px-4 pb-3 pt-5">
          <Logo version={logoVersion} className="h-9 w-9" rounded="rounded-lg" />
          <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="truncate text-[13.5px] font-semibold tracking-tight">{org || 'CELTTO'}</div>
            <div className="truncate text-[11px] text-slate-500">Gestión de turnos</div>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>
        <button onClick={() => setPalette(true)} className={`mx-3 mb-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[13px] text-slate-400 hover:bg-white/[0.06] ${collapsed ? 'lg:hidden' : ''}`}>
          <Search size={14} /> Buscar…
          <span className="ml-auto flex items-center gap-0.5 rounded border border-white/10 px-1.5 text-[10.5px]"><Command size={10} />K</span>
        </button>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 scrollbar-thin" aria-label="Secciones">
          {groups.map((g) => (
            <div key={g.title}>
              <div className={`mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 ${collapsed ? 'lg:hidden' : ''}`}>{g.title}</div>
              {collapsed && <div className="mx-3 mb-2 hidden h-px bg-white/10 lg:block" />}
              <div className="space-y-0.5">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={link} title={collapsed ? t(n.labelKey) : undefined}>
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="nav-active" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-teal-400" />}
                        <n.icon size={16} strokeWidth={1.8} className={`shrink-0 ${isActive ? 'text-teal-300' : 'opacity-75'}`} />
                        <span className={`whitespace-nowrap ${collapsed ? 'lg:hidden' : ''}`}>{t(n.labelKey)}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/5 p-3">
          <button onClick={() => setCollapsed((v) => !v)} className="hidden w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-slate-400 hover:bg-white/5 hover:text-slate-200 lg:flex" aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}>
            {collapsed ? <PanelLeftOpen size={16} className="mx-auto" /> : <><PanelLeftClose size={15} /> Contraer menú</>}
          </button>
          <div className={`grid grid-cols-2 gap-1 ${collapsed ? 'lg:hidden' : ''}`}>
            <a href="/totem" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-slate-400 hover:bg-white/5 hover:text-slate-200">
              <ExternalLink size={12} /> Tótem
            </a>
            <a href="/tv" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-slate-400 hover:bg-white/5 hover:text-slate-200">
              <ExternalLink size={12} /> TV
            </a>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur-md sm:px-6">
          <button onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-md p-1.5 text-muted hover:bg-paper lg:hidden">
            <Menu size={20} />
          </button>
          <nav className="flex min-w-0 items-center gap-1.5 text-[13px]" aria-label="Ubicación">
            <span className="hidden text-muted sm:inline">Panel</span>
            <ChevronRight size={14} className="hidden text-muted/60 sm:inline" />
            <span className="truncate font-medium">{current ? t(current.labelKey) : ''}</span>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setPalette(true)} className="hidden items-center gap-2 rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] text-muted hover:text-ink md:flex">
              <Search size={14} /> Buscar o ir a… <kbd className="rounded border border-line bg-surface px-1.5 text-[10.5px]">Ctrl K</kbd>
            </button>
            <span className="mx-1 hidden items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[11.5px] font-medium text-ok sm:flex">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" /> En vivo
            </span>

            {/* Notificaciones */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setMenu(menu === 'bell' ? null : 'bell')} className="relative rounded-lg p-2 text-muted hover:bg-paper hover:text-ink" aria-label="Notificaciones">
                <Bell size={18} />
                {visibleAlerts.length > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{visibleAlerts.length}</span>}
              </button>
              <AnimatePresence>
                {menu === 'bell' && (
                  <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }} className="surface-elevated absolute right-0 top-11 z-50 w-80 overflow-hidden">
                    <div className="border-b border-line px-4 py-3 text-[13px] font-semibold">Notificaciones</div>
                    {visibleAlerts.length === 0 ? (
                      <p className="px-4 py-6 text-center text-[13px] text-muted">Todo en orden. No hay alertas.</p>
                    ) : (
                      <ul className="max-h-80 divide-y divide-line overflow-auto">
                        {visibleAlerts.map((a, i) => (
                          <li key={i} className="flex gap-3 px-4 py-3 text-[13px]">
                            <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${a.type === 'station_stale' ? 'bg-danger-soft text-danger' : a.type === 'queue_high' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand'}`}>
                              {a.type === 'station_stale' ? <MonitorOff size={14} /> : a.type === 'queue_high' ? <AlertTriangle size={14} /> : <KeyIcon size={14} />}
                            </span>
                            <span className="text-ink-soft">
                              {a.type === 'queue_high' && <><b>{a.sectorName}</b> tiene {a.waiting} personas esperando.</>}
                              {a.type === 'station_stale' && <>{a.kind === 'tv' ? 'La TV' : 'El tótem'} <b>{a.name}</b> no se conecta.</>}
                              {a.type === 'default_pin' && <>El PIN del tótem sigue siendo el de fábrica. <NavLink to="/master/configuracion" className="text-brand">Cambiarlo</NavLink></>}
                              {a.type === 'mfa_recommended' && <>Activá el doble factor en tu cuenta. <NavLink to="/cuenta" className="text-brand">Activar</NavLink></>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Menú de usuario */}
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setMenu(menu === 'user' ? null : 'user')} className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-paper" aria-label="Menú de usuario">
                <Avatar name={user?.displayName ?? '?'} size={30} />
                <span className="hidden text-left leading-tight md:block">
                  <span className="block max-w-36 truncate text-[13px] font-medium">{user?.displayName}</span>
                  <span className="block text-[11px] text-muted">{ROLE_LABEL[role]}</span>
                </span>
                <ChevronDown size={14} className="text-muted" />
              </button>
              <AnimatePresence>
                {menu === 'user' && (
                  <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }} className="surface-elevated absolute right-0 top-11 z-50 w-60 overflow-hidden p-1.5">
                    <div className="px-3 py-2">
                      <div className="truncate text-[13px] font-semibold">{user?.displayName}</div>
                      <div className="truncate text-[12px] text-muted">{user?.username} · {ROLE_LABEL[role]}</div>
                    </div>
                    <div className="my-1 h-px bg-line" />
                    <NavLink to="/cuenta" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-paper"><UserCog size={15} className="text-muted" /> Mi cuenta y seguridad</NavLink>
                    <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-paper">{dark ? <Sun size={15} className="text-muted" /> : <Moon size={15} className="text-muted" />} {dark ? 'Tema claro' : 'Tema oscuro'}</button>
                    <div className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13.5px]"><LanguageSwitcher className="text-muted" /></div>
                    <div className="my-1 h-px bg-line" />
                    <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-danger hover:bg-danger-soft"><LogOut size={15} /> {t('nav.logout')}</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
            <AnimatePresence mode="wait">
              <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
                <Routes location={loc}>
                  <Route index element={can(user, 'overview.view') ? <Overview /> : <Navigate to={flat[0]?.to ?? '/cuenta'} replace />} />
                  {allowed('secretarias') && <Route path="secretarias" element={<Sectors />} />}
                  {allowed('escritorios') && <Route path="escritorios" element={<Desks />} />}
                  {allowed('estaciones') && <Route path="estaciones" element={<Stations />} />}
                  {allowed('reportes') && <Route path="reportes" element={<Reports />} />}
                  {allowed('sedes') && <Route path="sedes" element={<Sites />} />}
                  {allowed('publicidad') && <Route path="publicidad" element={<MediaPage />} />}
                  {allowed('monitoreo') && <Route path="monitoreo" element={<MonitorPage />} />}
                  {prioritiesOn && <Route path="prioridades" element={<Priorities />} />}
                  {allowed('usuarios') && <Route path="usuarios" element={<UsersPage />} />}
                  {allowed('configuracion') && <Route path="configuracion" element={<SettingsPage />} />}
                  {allowed('auditoria') && <Route path="auditoria" element={<Audit />} />}
                  <Route path="*" element={<Navigate to="/master" replace />} />
                </Routes>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      <AnimatePresence>{palette && <CommandPalette items={flat} onClose={() => setPalette(false)} />}</AnimatePresence>
    </div>
  )
}

/** Paleta de comandos: Ctrl+K para ir a cualquier sección o abrir pantallas. */
function CommandPalette({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const actions = useMemo(
    () => [
      ...items.map((i) => ({ id: i.to, label: t(i.labelKey), hint: i.hint, icon: i.icon, run: () => nav(i.to) })),
      { id: 'totem', label: 'Abrir tótem', hint: 'En una pestaña nueva', icon: ExternalLink, run: () => window.open('/totem', '_blank') },
      { id: 'tv', label: 'Abrir pantalla de sala', hint: 'En una pestaña nueva', icon: ExternalLink, run: () => window.open('/tv', '_blank') },
    ],
    [items, nav, t],
  )
  const list = actions.filter((a) => !q || `${a.label} ${a.hint}`.toLowerCase().includes(q.toLowerCase()))
  useEffect(() => input.current?.focus(), [])
  useEffect(() => setSel(0), [q])
  const go = (i: number) => {
    const a = list[i]
    if (!a) return
    a.run()
    onClose()
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.15 }}
        role="dialog"
        aria-label="Buscar"
        className="surface-elevated w-full max-w-lg overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
              if (e.key === 'Enter') go(sel)
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Buscar una sección o acción…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            aria-label="Buscar"
          />
          <kbd className="rounded border border-line px-1.5 text-[10.5px] text-muted">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-auto p-1.5 scrollbar-thin">
          {list.map((a, i) => (
            <li key={a.id}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(i)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${i === sel ? 'bg-brand-soft/70' : ''}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-lg ${i === sel ? 'bg-brand text-white' : 'bg-paper text-muted'}`}><a.icon size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">{a.label}</span>
                  <span className="block truncate text-[12px] text-muted">{a.hint}</span>
                </span>
                {i === sel && <ChevronRight size={16} className="text-muted" />}
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Sin resultados</li>}
        </ul>
      </motion.div>
    </motion.div>
  )
}
