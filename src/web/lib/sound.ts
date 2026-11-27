import type { CallTicket } from './api'
import i18n, { voiceLangFor } from '../i18n'

export function fillTemplate(tpl: string, t: Pick<CallTicket, 'code' | 'prefix' | 'number' | 'sectorName' | 'desk'>): string {
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
    const soft = voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()))
    if (soft) return soft
  }
  return voices[0] ?? null
}

type Job = { text: string; rate: number; volume: number; chime: boolean; voice: boolean; langCode?: string }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Campanilla + voz con COLA: si llaman dos turnos seguidos, el segundo espera a que termine el primero
 * (antes se cortaba el anuncio anterior con speechSynthesis.cancel()).
 */
export class Announcer {
  private ctx: AudioContext | null = null
  private queue: Job[] = []
  private playing = false

  constructor() {
    try {
      this.ctx = new AudioContext()
    } catch {
      this.ctx = null
    }
  }

  /** true si el navegador ya permite reproducir audio (p. ej. Chrome con --autoplay-policy). */
  get ready() {
    return this.ctx?.state === 'running'
  }

  async unlock() {
    try {
      await this.ctx?.resume()
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      speechSynthesis.speak(u)
    } catch {
      /* sin audio */
    }
    return this.ready
  }

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

  /** Habla y resuelve cuando termina (con tope de seguridad por si el navegador no avisa). */
  speak(text: string, rate: number, langCode?: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const u = new SpeechSynthesisUtterance(text)
        const langs = voiceLangFor(langCode || i18n.language)
        const v = pickVoice(langs)
        if (v) {
          u.voice = v
          u.lang = v.lang
        } else u.lang = langs[0] ?? 'es-AR'
        u.rate = Math.max(0.5, Math.min(1.5, rate))
        const done = () => resolve()
        u.onend = done
        u.onerror = done
        setTimeout(done, 4000 + text.length * 120)
        speechSynthesis.speak(u)
      } catch {
        resolve()
      }
    })
  }

  announce(job: Job) {
    this.queue.push(job)
    if (this.queue.length > 5) this.queue.splice(0, this.queue.length - 5)
    void this.drain()
  }

  private async drain() {
    if (this.playing) return
    this.playing = true
    while (this.queue.length) {
      const j = this.queue.shift()!
      const d = j.chime ? this.chime(j.volume) : 0
      if (d) await wait(d)
      if (j.voice && j.text) await this.speak(j.text, j.rate, j.langCode)
      await wait(400)
    }
    this.playing = false
  }
}
