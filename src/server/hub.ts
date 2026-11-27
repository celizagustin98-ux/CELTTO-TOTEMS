import type { WebSocket } from 'ws'
import { MemoryCounterStore, type CounterStore } from './security.js'

export type Broadcaster = {
  broadcast(msg: unknown): void
  size: number
  ping(): void
  /** Devuelve false si se superó el límite de conexiones. */
  add(ws: WebSocket, ip: string): boolean
  close?(): Promise<void>
  mode: 'memory' | 'redis'
  counters: CounterStore
}

export interface HubLimits {
  maxClients: number
  maxPerIp: number
}

export class Hub implements Broadcaster {
  mode: 'memory' | 'redis' = 'memory'
  counters: CounterStore = new MemoryCounterStore()
  readonly clients = new Set<WebSocket>()
  private perIp = new Map<string, number>()

  constructor(private limits: HubLimits = { maxClients: 2000, maxPerIp: 60 }) {}

  add(ws: WebSocket, ip: string) {
    const n = this.perIp.get(ip) ?? 0
    if (this.clients.size >= this.limits.maxClients || n >= this.limits.maxPerIp) return false
    this.clients.add(ws)
    this.perIp.set(ip, n + 1)
    let gone = false
    const drop = () => {
      if (gone) return
      gone = true
      this.clients.delete(ws)
      const left = (this.perIp.get(ip) ?? 1) - 1
      if (left <= 0) this.perIp.delete(ip)
      else this.perIp.set(ip, left)
    }
    ws.on('close', drop)
    ws.on('error', drop)
    return true
  }

  deliver(data: string) {
    for (const c of this.clients) if (c.readyState === 1) c.send(data)
  }

  broadcast(msg: unknown) {
    this.deliver(JSON.stringify(msg))
  }

  ping() {
    for (const c of this.clients) if (c.readyState === 1) c.ping()
  }

  get size() {
    return this.clients.size
  }
}

class RedisCounterStore implements CounterStore {
  constructor(private redis: any) {}
  async incr(key: string, windowMs: number) {
    const n = Number(await this.redis.incr(key))
    if (n === 1) await this.redis.pexpire(key, windowMs)
    return n
  }
  async reset(key: string) {
    await this.redis.del(key)
  }
}

export async function createHub(redisUrl: string | undefined, limits?: HubLimits): Promise<Broadcaster> {
  if (!redisUrl) return new Hub(limits)
  try {
    const mod: any = await import('ioredis')
    const Redis = mod.Redis ?? mod.default
    const local = new Hub(limits)
    const opts = { maxRetriesPerRequest: 3, enableReadyCheck: true, lazyConnect: false }
    const pub = new Redis(redisUrl, opts)
    const sub = new Redis(redisUrl, opts)
    const channel = 'celtto:events'
    await sub.subscribe(channel)
    sub.on('message', (_ch: string, message: string) => local.deliver(message))
    pub.on('error', (e: Error) => console.error('redis pub', e.message))
    sub.on('error', (e: Error) => console.error('redis sub', e.message))
    return {
      mode: 'redis',
      counters: new RedisCounterStore(pub),
      add: (ws, ip) => local.add(ws, ip),
      broadcast: (msg) => void pub.publish(channel, JSON.stringify(msg)),
      ping: () => local.ping(),
      get size() {
        return local.size
      },
      close: async () => {
        await sub.quit()
        await pub.quit()
      },
    }
  } catch (e) {
    console.error('Redis no disponible, usando hub en memoria:', (e as Error).message)
    return new Hub(limits)
  }
}
