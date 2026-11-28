import { useState } from 'react'

/** Barras verticales simples (sin librerías) con tooltip al pasar el mouse. */
export function BarChart({ data, height = 160, color = 'var(--color-brand)', format = (n: number) => String(n) }: { data: { label: string; value: number; color?: string }[]; height?: number; color?: string; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  if (!data.length) return <div className="grid place-items-center text-sm text-muted" style={{ height }}>Sin datos en el período</div>
  return (
    <div>
      <div className="relative flex items-end gap-1" style={{ height }} role="img" aria-label="Gráfico de barras">
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <div key={g} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} />
        ))}
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div
              className="w-full rounded-t-[4px] transition-opacity"
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0, background: d.color ?? color, opacity: hover === null || hover === i ? 1 : 0.45 }}
            />
            {hover === i && (
              <div className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-paper shadow">
                {d.label}: {format(d.value)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        {data.map((d, i) => (
          <span key={d.label} className="flex-1 truncate text-center text-[10px] text-muted">
            {data.length > 16 && i % 2 ? '' : d.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Barras horizontales para comparar secretarías / estados. */
export function HBars({ data, format = (n: number) => String(n) }: { data: { label: string; value: number; color?: string; hint?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  if (!data.length) return <div className="py-6 text-center text-sm text-muted">Sin datos en el período</div>
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate font-medium">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted">
              {format(d.value)}
              {d.hint ? ` · ${d.hint}` : ''}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-paper">
            <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? 'var(--color-brand)' }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Indicador grande para el tablero. */
export function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  return (
    <div className="surface px-4 py-3.5">
      <div className="text-[13px] text-muted">{label}</div>
      <div className={`num mt-0.5 text-3xl leading-tight ${tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-muted">{sub}</div>}
    </div>
  )
}

/** Completa las horas sin turnos (por defecto de 7 a 20 h) para que el gráfico muestre la jornada completa. */
export function fillHours(rows: { hour: string; count: number }[], from = 7, to = 20) {
  const nums = rows.map((r) => Number(r.hour)).filter((n) => !Number.isNaN(n))
  const a = Math.min(from, ...nums)
  const b = Math.max(to, ...nums)
  const out: { label: string; value: number }[] = []
  for (let h = a; h <= b; h++) out.push({ label: `${h}h`, value: rows.find((r) => Number(r.hour) === h)?.count ?? 0 })
  return out
}
