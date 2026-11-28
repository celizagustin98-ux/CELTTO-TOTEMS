import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Armchair, BarChart3, ChevronRight, Contact, ExternalLink, Flag, Layers, LayoutGrid, LogOut, Menu, Monitor, ScrollText, Search,
  Settings as Cog, Users, X, Command,
} from 'lucide-react'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Brand'
import { MANAGERS, ROLE_LABEL, useAuth } from '../auth'
import { api, type Role } from '../lib/api'
import { useLive } from '../lib/live'
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
import Patients from './MasterPatients'

const ALL: Role[] = ['owner', 'admin', 'tech']
type NavItem = { to: string; end?: boolean; labelKey: string; icon: typeof LayoutGrid; roles: Role[]; hint: string; needsPriorities?: boolean }
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operación',
    items: [
      { to: '/master', end: true, labelKey: 'nav.overview', icon: LayoutGrid, roles: ALL, hint: 'Colas en vivo, alertas y turnos de hoy' },
      { to: '/master/pacientes', labelKey: 'nav.patients', icon: Contact, roles: ALL, hint: 'Base de pacientes e historial de visitas' },
      { to: '/master/reportes', labelKey: 'nav.reports', icon: BarChart3, roles: ALL, hint: 'Tiempos de espera, atención y exportación' },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { to: '/master/secretarias', labelKey: 'nav.sectors', icon: Layers, roles: ALL, hint: 'Colas y botones del tótem' },
      { to: '/master/escritorios', labelKey: 'nav.desks', icon: Armchair, roles: ALL, hint: 'Boxes y ventanillas' },
      { to: '/master/estaciones', labelKey: 'nav.stations', icon: Monitor, roles: ALL, hint: 'Direcciones fijas de tótems y TVs' },
      { to: '/master/prioridades', labelKey: 'nav.priorities', icon: Flag, roles: ALL, hint: 'Atención preferencial', needsPriorities: true },
    ],
  },
  {
    title: 'Administración',
    items: [
      { to: '/master/usuarios', labelKey: 'nav.users', icon: Users, roles: MANAGERS, hint: 'Secretarias, técnicos y administradores' },
      { to: '/master/configuracion', labelKey: 'nav.settings', icon: Cog, roles: MANAGERS, hint: 'Marca, tótem, TV y publicidad' },
      { to: '/master/auditoria', labelKey: 'nav.audit', icon: ScrollText, roles: MANAGERS, hint: 'Accesos y cambios' },
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
  useLive((m) => m.type === 'config' && void loadBrand())
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
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => n.roles.includes(role) && (!n.needsPriorities || prioritiesOn)) })).filter((g) => g.items.length)
  const flat = groups.flatMap((g) => g.items)
  const can = (path: string) => flat.some((n) => n.to === `/master/${path}`)
  const current = [...flat].sort((a, b) => b.to.length - a.to.length).find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))

  const link = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors ${
      isActive ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
    }`

  return (
    <div className="flex min-h-full bg-mesh">
      {open && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[16.5rem] flex-col bg-sidebar text-white transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-3 px-4 pb-3 pt-5">
          <Logo version={logoVersion} className="h-9 w-9" rounded="rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold tracking-tight">{org || 'CELTTO'}</div>
            <div className="truncate text-[11px] text-slate-500">Gestión de turnos</div>
          </div>
          <button onClick={() => setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 lg:hidden" aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>
        <button onClick={() => setPalette(true)} className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-[13px] text-slate-400 hover:bg-white/[0.06]">
          <Search size={14} /> Buscar…
          <span className="ml-auto flex items-center gap-0.5 rounded border border-white/10 px-1.5 text-[10.5px]"><Command size={10} />K</span>
        </button>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 scrollbar-thin" aria-label="Secciones">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{g.title}</div>
              <div className="space-y-0.5">
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="nav-active" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-teal-400" />}
                        <n.icon size={16} strokeWidth={1.8} className={`shrink-0 ${isActive ? 'text-teal-300' : 'opacity-75'}`} />
                        <span className="whitespace-nowrap">{t(n.labelKey)}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/5 p-3">
          <div className="grid grid-cols-2 gap-1">
            <a href="/totem" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-slate-400 hover:bg-white/5 hover:text-slate-200">
              <ExternalLink size={12} /> Tótem
            </a>
            <a href="/tv" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-slate-400 hover:bg-white/5 hover:text-slate-200">
              <ExternalLink size={12} /> TV
            </a>
          </div>
          <div className="flex items-center justify-between px-1 text-slate-400">
            <LanguageSwitcher />
            <ThemeToggle className="hover:bg-white/10 hover:text-white" />
          </div>
          <div className="mt-1 flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-2.5 py-2">
            <Avatar name={user?.displayName ?? '?'} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-slate-100">{user?.displayName}</div>
              <div className="text-[11px] text-slate-500">{ROLE_LABEL[role]}</div>
            </div>
            <button onClick={logout} aria-label={t('nav.logout')} title={t('nav.logout')} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
              <LogOut size={16} />
            </button>
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
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setPalette(true)} className="hidden items-center gap-2 rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] text-muted hover:text-ink md:flex">
              <Search size={14} /> Buscar o ir a… <kbd className="rounded border border-line bg-surface px-1.5 text-[10.5px]">Ctrl K</kbd>
            </button>
            <span className="hidden items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-[11.5px] font-medium text-ok sm:flex">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" /> En vivo
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
            <AnimatePresence mode="wait">
              <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
                <Routes location={loc}>
                  <Route index element={<Overview />} />
                  <Route path="pacientes" element={<Patients />} />
                  <Route path="secretarias" element={<Sectors />} />
                  <Route path="escritorios" element={<Desks />} />
                  <Route path="estaciones" element={<Stations />} />
                  <Route path="reportes" element={<Reports />} />
                  {prioritiesOn && <Route path="prioridades" element={<Priorities />} />}
                  {can('usuarios') && <Route path="usuarios" element={<UsersPage />} />}
                  {can('configuracion') && <Route path="configuracion" element={<SettingsPage />} />}
                  {can('auditoria') && <Route path="auditoria" element={<Audit />} />}
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
