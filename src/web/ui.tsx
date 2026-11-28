import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, Moon, Sun, X } from 'lucide-react'
import QRCode from 'qrcode'
import { PALETTE } from './lib/format'

export const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14.5px] text-ink shadow-sm placeholder:text-muted/60 transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-paper disabled:text-muted'

const variants = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-sm shadow-brand/20',
  soft: 'bg-surface text-ink border border-line hover:bg-paper hover:border-line-strong shadow-sm',
  ghost: 'bg-transparent text-muted hover:bg-paper hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90 shadow-sm',
  success: 'bg-ok text-white hover:opacity-90 shadow-sm',
} as const

const sizes = {
  sm: 'h-8 px-3 text-[13px] rounded-md gap-1.5',
  md: 'h-10 px-4 text-[14px] rounded-lg gap-2',
  lg: 'h-11 px-5 text-[15px] rounded-lg gap-2',
  xl: 'h-14 px-6 text-[16px] rounded-xl gap-2.5',
} as const

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return (
    <button
      type="button"
      {...p}
      className={`inline-flex items-center justify-center font-medium transition-[background,opacity,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
    />
  )
}

/** Atajo de teclado dibujado como tecla. */
export const Kbd = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <kbd className={`ml-1 rounded border border-current/25 bg-black/5 px-1.5 py-0.5 font-sans text-[11px] font-semibold opacity-70 ${className}`}>{children}</kbd>
)

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[13px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="block text-[12px] leading-snug text-muted">{hint}</span>}
    </label>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`surface ${className}`}>{children}</div>
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="display text-[1.65rem] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`surface-elevated fade-up w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-auto`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-3.5">
          <h2 className="display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-lg p-1 text-left hover:bg-paper/60">
      <span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-line-strong'}`}>
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
      <span>
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] text-muted">{hint}</span>}
      </span>
    </button>
  )
}

/** Paleta rápida + selector libre de color (cualquier hex). */
export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 transition ${value.toLowerCase() === c ? 'scale-110 border-ink' : 'border-transparent'}`}
          style={{ background: c }}
          aria-label={`Color ${c}`}
        />
      ))}
      <label className="relative inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2 text-xs text-muted hover:border-line-strong" title="Elegir otro color">
        <span className="h-4 w-4 rounded-full border border-line" style={{ background: value }} />
        <span className="font-mono">{value}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Color personalizado" />
      </label>
    </div>
  )
}

export const Empty = ({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) => (
  <div className="surface flex flex-col items-center justify-center px-6 py-14 text-center">
    {icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</div>}
    <div className="display text-lg font-semibold text-ink">{title}</div>
    {hint && <p className="mt-1.5 max-w-sm text-[14px] text-muted">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)

export const Spinner = ({ className = '' }: { className?: string }) => (
  <div className={`flex justify-center py-16 ${className}`} role="status" aria-label="Cargando">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-brand" />
  </div>
)

export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => (
  <div className="surface flex flex-col items-start gap-3 border-danger/20 bg-danger-soft p-5" role="alert">
    <p className="text-[14px] text-danger">{msg}</p>
    {retry && (
      <Button variant="soft" size="sm" onClick={retry}>
        Reintentar
      </Button>
    )}
  </div>
)

/** Avatar con iniciales y color estable según el nombre. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <span className="grid shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white" style={{ width: size, height: size, background: `hsl(${h} 55% 42%)` }} aria-hidden>
      {initials}
    </span>
  )
}

/** Código QR dibujado en el navegador (sin servicios externos). */
export function QR({ value, size = 160, className = '', dark = '#0b1220', light = '#ffffff' }: { value: string; size?: number; className?: string; dark?: string; light?: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M', color: { dark, light } })
      .then((u) => alive && setSrc(u))
      .catch(() => setSrc(''))
    return () => {
      alive = false
    }
  }, [value, size, dark, light])
  return src ? <img src={src} width={size} height={size} alt={`Código QR: ${value}`} className={className} /> : <div style={{ width: size, height: size }} className={className} />
}

// ---------- Avisos (toasts) ----------
type Toast = { id: number; msg: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs.slice(-3), { id, msg, kind }])
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(100%-2rem,24rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13.5px] shadow-lg ${
              t.kind === 'error' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-line bg-surface text-ink'
            }`}
          >
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t.kind === 'error' ? 'bg-danger' : 'bg-ok'}`} />
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- Confirmación (reemplaza window.confirm) ----------
type ConfirmOpts = { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), [])
  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <Modal
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <Button variant="soft" onClick={() => close(false)}>
                Cancelar
              </Button>
              <Button variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
                {state.confirmLabel ?? 'Confirmar'}
              </Button>
            </>
          }
        >
          <div className="flex gap-3">
            {state.danger && (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
                <AlertTriangle size={20} />
              </span>
            )}
            <div className="text-[14px] leading-relaxed text-ink-soft">{state.message}</div>
          </div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  )
}

// ---------- Tema claro / oscuro (paneles de personal) ----------
const THEME_KEY = 'celtto.theme'
export function applyStoredTheme() {
  try {
    // Tótem, TV y estado del turno tienen su propio diseño oscuro fijo
    if (/^\/(totem|tv|t)(\/|$)/.test(location.pathname)) return
    const t = localStorage.getItem(THEME_KEY)
    const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', dark)
  } catch {
    /* sin almacenamiento */
  }
}
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light')
    } catch {
      /* sin almacenamiento */
    }
  }
  return { dark, toggle }
}
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { dark, toggle } = useTheme()
  return (
    <button onClick={toggle} className={`rounded-md p-1.5 transition-colors ${className}`} aria-label={dark ? 'Usar tema claro' : 'Usar tema oscuro'} title={dark ? 'Tema claro' : 'Tema oscuro'}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

/** Escucha atajos de teclado globales (ignora cuando se escribe en un campo). */
export function useHotkeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      const fn = ref.current[e.key]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

// ---------- Piezas SaaS ----------

/** Número que sube animado hasta su valor (KPIs). */
export function CountUp({ value, duration = 700, format = (n: number) => String(Math.round(n)) }: { value: number; duration?: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration)
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(a + (value - a) * eased)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{format(shown)}</>
}

export const Skeleton = ({ className = '' }: { className?: string }) => <div className={`skeleton ${className}`} aria-hidden />

export function SkeletonPage() {
  return (
    <div className="space-y-6" role="status" aria-label="Cargando">
      <Skeleton className="h-9 w-64" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

/** Control segmentado (2–4 opciones). */
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-paper p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`relative rounded-lg font-medium transition-colors ${size === 'sm' ? 'px-2.5 py-1 text-[12.5px]' : 'px-3.5 py-1.5 text-[13.5px]'} ${value === o.value ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Tarjeta de indicador con ícono, número animado y variación. */
export function StatCard({ label, value, icon, hint, tone, format }: { label: string; value: number; icon?: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'brand'; format?: (n: number) => string }) {
  const toneCls = tone === 'danger' ? 'bg-danger-soft text-danger' : tone === 'warn' ? 'bg-warn-soft text-warn' : tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-brand'
  return (
    <div className="surface card-hover relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[13px] font-medium text-muted">{label}</div>
        {icon && <span className={`grid h-8 w-8 place-items-center rounded-lg ${toneCls}`}>{icon}</span>}
      </div>
      <div className={`num mt-2 text-[2rem] leading-none ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''}`}>
        <CountUp value={value} format={format} />
      </div>
      {hint && <div className="mt-1.5 text-[12px] text-muted">{hint}</div>}
    </div>
  )
}
