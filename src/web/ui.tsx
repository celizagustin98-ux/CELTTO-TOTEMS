import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { PALETTE } from './lib/format'

export const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14.5px] text-ink shadow-sm placeholder:text-muted/60 transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-paper disabled:text-muted'

const variants = {
  primary: 'bg-brand text-white hover:bg-brand-hover shadow-sm shadow-brand/20',
  soft: 'bg-white text-ink border border-line hover:bg-paper hover:border-line-strong shadow-sm',
  ghost: 'bg-transparent text-muted hover:bg-paper hover:text-ink',
  danger: 'bg-danger text-white hover:bg-red-700 shadow-sm',
  success: 'bg-ok text-white hover:bg-emerald-700 shadow-sm',
} as const

const sizes = {
  sm: 'h-8 px-3 text-[13px] rounded-md gap-1.5',
  md: 'h-10 px-4 text-[14px] rounded-lg gap-2',
  lg: 'h-11 px-5 text-[15px] rounded-lg gap-2',
} as const

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
    />
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className={`surface-elevated fade-up w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[90vh] overflow-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-lg p-1 text-left">
      <span
        className={`mt-0.5 relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-line-strong'}`}
        role="switch"
        aria-checked={checked}
      >
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
      <span>
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] text-muted">{hint}</span>}
      </span>
    </button>
  )
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 transition ${value === c ? 'border-ink scale-110' : 'border-transparent'}`}
          style={{ background: c }}
          aria-label={c}
        />
      ))}
    </div>
  )
}

export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="surface flex flex-col items-center justify-center px-6 py-14 text-center">
    <div className="display text-lg font-semibold text-ink">{title}</div>
    {hint && <p className="mt-1.5 max-w-sm text-[14px] text-muted">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)

export const Spinner = () => (
  <div className="flex justify-center py-16">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-brand" />
  </div>
)

export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => (
  <div className="surface flex flex-col items-start gap-3 border-danger/20 bg-danger-soft p-5">
    <p className="text-[14px] text-danger">{msg}</p>
    {retry && (
      <Button variant="soft" size="sm" onClick={retry}>
        Reintentar
      </Button>
    )}
  </div>
)

type Toast = { id: number; msg: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((xs) => [...xs, { id, msg, kind }])
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(100%-2rem,22rem)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`fade-up pointer-events-auto rounded-lg border px-3.5 py-2.5 text-[13.5px] shadow-lg ${
              t.kind === 'error' ? 'border-red-200 bg-white text-danger' : 'border-line bg-white text-ink'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
