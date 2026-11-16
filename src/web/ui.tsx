import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { PALETTE } from './lib/format'

export const inputCls = 'w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25'

const variants = {
  primary: 'bg-ink text-white hover:bg-ink-soft disabled:bg-ink/40',
  soft: 'bg-white text-ink border border-line hover:bg-paper disabled:text-muted/60',
  danger: 'bg-white text-danger border border-danger/30 hover:bg-danger/5',
  ghost: 'text-ink-soft hover:bg-ink/5',
}
export function Button({ variant = 'primary', size = 'md', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-6 py-4 text-lg' : 'px-4 py-2.5 text-[15px]'
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${sz} ${variants[variant]} ${className}`} />
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="display text-xl font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-md p-1.5 text-muted hover:bg-paper"><X size={20} /></button>
        </div>
        <div className="space-y-4 px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-paper/60 px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div><div className="text-[15px] font-medium">{label}</div>{hint && <div className="text-sm text-muted">{hint}</div>}</div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-ok' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE.map((c) => (
        <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => onChange(c)} style={{ background: c }}
          className={`h-8 w-8 rounded-full ring-offset-2 ${value.toLowerCase() === c ? 'ring-2 ring-ink' : ''}`} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Color personalizado" className="h-8 w-10 cursor-pointer rounded border border-line bg-white" />
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-white ${className}`}>{children}</section>
}
export const Empty = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-line bg-white/60 px-6 py-12 text-center">
    <div className="display text-lg font-semibold">{title}</div>
    {hint && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
)
export const Spinner = () => <div className="flex justify-center py-16"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-line border-t-ink" /></div>
export const ErrorBox = ({ msg, retry }: { msg: string; retry?: () => void }) => (
  <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{msg}{retry && <button onClick={retry} className="ml-3 font-medium underline">Reintentar</button>}</div>
)

type ToastKind = 'ok' | 'error'
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([])
  const push = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, msg, kind }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((i) => <div key={i.id} className={`pointer-events-auto max-w-sm rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${i.kind === 'ok' ? 'bg-ink' : 'bg-danger'}`}>{i.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}
