import type { CallTicket } from './api'
import { voiceLangFor } from '../i18n'
import i18n from '../i18n'

export function fillTemplate(
  tpl: string,
  t: Pick<CallTicket, 'code' | 'prefix' | 'number' | 'sectorName' | 'desk'>,
): string {
  const place = t.desk ? `${t.sectorName}, ${t.desk}` : t.sectorName
  const map: Record<string, string> = {
    prefix: t.prefix.split('').join(' '),
    number: String(t.number),
    code: t.code,
    sector: t.sectorName,
    desk: t.desk ?? '',
    place,
  }
  return tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '')
}

function pickVoice(langs: string[]): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices()
  for (const lang of langs) {
    const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
    if (exact) return exact
    const prefix = lang.slice(0, 2).toLowerCase()
    const soft = voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
    if (soft) return soft
  }
  return voices[0] ?? null
}

export class Announcer {
  private ctx: AudioContext | null = null
  private unlocked = false

  constructor() {
    try {
      this.ctx = new AudioContext()
    } catch {
      this.ctx = null
    }
  }

  get ready() {
    return this.unlocked && this.ctx?.state === 'running'
  }

  async unlock() {
    try {
      await this.ctx?.resume()
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      speechSynthesis.speak(u)
      this.unlocked = true
    } catch {
      this.unlocked = false
    }
  }

  /** Campanilla de llamado (dos tonos). Devuelve duración aprox. en ms. */
  chime(volume: number): number {
    const c = this.ctx
    if (!c || c.state !== 'running') return 0
    const t0 = c.currentTime
    const vol = Math.max(0.02, Math.min(1, volume))
    ;([
      [880, 0, 0.9],
      [1174.7, 0.18, 0.7],
      [1318.5, 0.36, 0.55],
    ] as const).forEach(([freq, delay, gainMul]) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + delay)
      g.gain.exponentialRampToValueAtTime(vol * gainMul, t0 + delay + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.55)
      o.connect(g).connect(c.destination)
      o.start(t0 + delay)
      o.stop(t0 + delay + 0.6)
    })
    return 1100
  }

  /** Voz del navegador según idioma de la app. */
  speak(text: string, rate: number, langCode?: string) {
    try {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      const langs = voiceLangFor(langCode || i18n.language)
      const v = pickVoice(langs)
      if (v) {
        u.voice = v
        u.lang = v.lang
      } else {
        u.lang = langs[0] ?? 'es-AR'
      }
      u.rate = Math.max(0.5, Math.min(1.5, rate))
      u.pitch = 1
      speechSynthesis.speak(u)
    } catch {
      /* sin voz disponible */
    }
  }

  /** Campanilla + voz con pausa entre ambas. */
  announce(opts: {
    text: string
    rate: number
    volume: number
    chime: boolean
    voice: boolean
    langCode?: string
  }) {
    const delay = opts.chime ? this.chime(opts.volume) : 0
    if (opts.voice && opts.text) {
      window.setTimeout(() => this.speak(opts.text, opts.rate, opts.langCode), delay)
    }
    return delay
  }
}
