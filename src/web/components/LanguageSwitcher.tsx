import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { setAppLanguage, SUPPORTED_LANGS, type LangCode } from '../i18n'

/** Selector compacto para los paneles del personal. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation()
  return (
    <label className={`inline-flex items-center gap-1.5 text-[12.5px] ${className}`}>
      <Globe size={14} className="opacity-60" aria-hidden />
      <select
        className="cursor-pointer rounded-md border border-current/15 bg-transparent px-1.5 py-1 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand/30 [&>option]:text-ink"
        value={i18n.language?.slice(0, 2) || 'es'}
        onChange={(e) => setAppLanguage(e.target.value as LangCode)}
        aria-label={t('app.language')}
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Botones grandes de idioma para el tótem táctil. */
export function LanguagePills({ className = '' }: { className?: string }) {
  const { i18n } = useTranslation()
  const cur = i18n.language?.slice(0, 2) || 'es'
  return (
    <div className={`flex gap-1.5 ${className}`} role="group" aria-label="Idioma / Language">
      {SUPPORTED_LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setAppLanguage(l.code)
          }}
          aria-pressed={cur === l.code}
          title={l.label}
          className={`min-h-11 min-w-12 rounded-xl px-3 text-sm font-semibold uppercase tracking-wide transition ${
            cur === l.code ? 'bg-white text-night shadow' : 'bg-white/10 text-white/80 hover:bg-white/20'
          }`}
        >
          {l.code}
        </button>
      ))}
    </div>
  )
}
