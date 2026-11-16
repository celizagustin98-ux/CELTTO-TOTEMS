import type { CallTicket } from './api'

export function fillTemplate(tpl: string, t: Pick<CallTicket, 'code' | 'prefix' | 'number' | 'sectorName' | 'desk'>): string {
  const place = t.desk ? `${t.sectorName}, ${t.desk}` : t.sectorName
  const map: Record<string, string> = { prefix: t.prefix.split('').join(' '), number: String(t.number), code: t.code, sector: t.sectorName, desk: t.desk ?? '', place }
  return tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '')
}

export class Announcer {
  private ctx: AudioContext | null = null
  constructor() { try { this.ctx = new AudioContext() } catch { this.ctx = null } }
  get ready() { return this.ctx?.state === 'running' }
  async unlock() {
    await this.ctx?.resume()
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u) } catch {  }
  }
  
  chime(volume: number): number {
    const c = this.ctx
    if (!c || c.state !== 'running') return 0
    const t0 = c.currentTime
    ;([[880, 0], [659.25, 0.3]] as const).forEach(([freq, delay]) => {
      const o = c.createOscillator(), g = c.createGain()
      o.type = 'sine'; o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + delay)
      g.gain.exponentialRampToValueAtTime(Math.max(volume, 0.02) * 0.7, t0 + delay + 0.03)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 1)
      o.connect(g).connect(c.destination); o.start(t0 + delay); o.stop(t0 + delay + 1.1)
    })
    return 1000
  }
  speak(text: string, rate: number) {
    try {
      const u = new SpeechSynthesisUtterance(text)
      const voices = speechSynthesis.getVoices()
      const v = voices.find((x) => x.lang.toLowerCase() === 'es-ar') ?? voices.find((x) => x.lang.toLowerCase().startsWith('es'))
      u.lang = v?.lang ?? 'es-AR'; if (v) u.voice = v
      u.rate = rate
      speechSynthesis.speak(u)
    } catch {  }
  }
}
