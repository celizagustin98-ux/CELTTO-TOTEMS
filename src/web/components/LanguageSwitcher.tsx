import { useTranslation } from 'react-i18next'
import { setAppLanguage, SUPPORTED_LANGS, type LangCode } from '../i18n'
import { inputCls } from '../ui'

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { i18n, t } = useTranslation()
  return (
    <label className={`inline-flex items-center gap-2 text-[12.5px] ${className}`}>
      <span className="opacity-70">{t('app.language')}</span>
      <select
        className={`${inputCls} !py-1 !px-2 !text-[12.5px] !w-auto min-w-[7.5rem] bg-transparent`}
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
