import { Delete, Space } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Teclado numérico grande para el tótem táctil. */
export function NumPad({ onKey, onDelete, onClear }: { onKey: (d: string) => void; onDelete: () => void; onClear: () => void }) {
  const { t } = useTranslation()
  const key = 'num h-[4.5rem] rounded-2xl bg-white/[0.07] text-4xl text-white ring-1 ring-white/10 transition active:scale-95 active:bg-white/20 hover:bg-white/[0.11]'
  return (
    <div className="grid grid-cols-3 gap-3">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} type="button" onClick={() => onKey(d)} className={key}>{d}</button>
      ))}
      <button type="button" onClick={onClear} className="h-[4.5rem] rounded-2xl bg-white/[0.04] text-lg font-semibold text-white/70 ring-1 ring-white/10 active:scale-95">{t('totem.clear')}</button>
      <button type="button" onClick={() => onKey('0')} className={key}>0</button>
      <button type="button" onClick={onDelete} className="grid h-[4.5rem] place-items-center rounded-2xl bg-white/[0.04] text-white/80 ring-1 ring-white/10 active:scale-95" aria-label="Borrar">
        <Delete size={30} />
      </button>
    </div>
  )
}

const ROWS = ['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM']

/** Teclado alfabético en pantalla (con Ñ) para cargar nombre y apellido sin teclado físico. */
export function AlphaKeyboard({ onKey, onDelete }: { onKey: (c: string) => void; onDelete: () => void }) {
  const { t } = useTranslation()
  const key = 'h-14 min-w-0 flex-1 rounded-xl bg-white/[0.08] text-xl font-semibold text-white ring-1 ring-white/10 transition active:scale-95 active:bg-white/25'
  return (
    <div className="space-y-2 select-none">
      {ROWS.map((r, i) => (
        <div key={r} className="flex gap-2" style={{ paddingInline: i === 2 ? '7%' : i === 1 ? '2%' : 0 }}>
          {r.split('').map((c) => (
            <button key={c} type="button" onClick={() => onKey(c)} className={key}>{c}</button>
          ))}
          {i === 2 && (
            <button type="button" onClick={onDelete} className="grid h-14 w-24 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/80 ring-1 ring-white/10 active:scale-95" aria-label="Borrar">
              <Delete size={24} />
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-2 px-[18%]">
        <button type="button" onClick={() => onKey('-')} className={`${key} !flex-none w-16`}>-</button>
        <button type="button" onClick={() => onKey(' ')} className={`${key} flex items-center justify-center gap-2 text-base`}><Space size={20} /> {t('reg.space')}</button>
        <button type="button" onClick={() => onKey("'")} className={`${key} !flex-none w-16`}>'</button>
      </div>
    </div>
  )
}
