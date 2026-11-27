import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import es from './locales/es.json'
import en from './locales/en.json'
import pt from './locales/pt.json'
import it from './locales/it.json'

export const SUPPORTED_LANGS = [
  { code: 'es', label: 'Español', voice: ['es-AR', 'es-ES', 'es-MX', 'es'] },
  { code: 'en', label: 'English', voice: ['en-US', 'en-GB', 'en'] },
  { code: 'pt', label: 'Português', voice: ['pt-BR', 'pt-PT', 'pt'] },
  { code: 'it', label: 'Italiano', voice: ['it-IT', 'it'] },
] as const

export type LangCode = (typeof SUPPORTED_LANGS)[number]['code']

let stored: string | null = null
try {
  stored = localStorage.getItem('celtto.lang')
} catch {
  /* sin almacenamiento */
}
const initial = (SUPPORTED_LANGS.some((l) => l.code === stored) ? stored : 'es') as LangCode

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
    pt: { translation: pt },
    it: { translation: it },
  },
  lng: initial,
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
})

export function setAppLanguage(code: LangCode, persist = true) {
  try {
    if (persist) localStorage.setItem('celtto.lang', code)
  } catch {
    /* sin almacenamiento */
  }
  void i18n.changeLanguage(code)
  document.documentElement.lang = code
}

export const isLang = (c: unknown): c is LangCode => SUPPORTED_LANGS.some((l) => l.code === c)

export function voiceLangFor(code?: string): string[] {
  const lang = SUPPORTED_LANGS.find((l) => l.code === (code || i18n.language))
  return [...(lang?.voice ?? ['es-AR', 'es'])]
}

export default i18n
