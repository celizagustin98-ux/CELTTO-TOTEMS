import type { WebSocket } from 'ws'

export type Broadcaster = {
  broadcast(msg: unknown): void
  size: number
  ping(): void
  add(ws: WebSocket): void
  close?(): Promise<void>
  mode: 'memory' | 'redis'
}

export class Hub implements Broadcaster {
  mode: 'memory' | 'redis' = 'memory'
  private clients = new Set<WebSocket>()

  add(ws: WebSocket) {
    this.clients.add(ws)
    ws.on('close', () => this.clients.delete(ws))
    ws.on('error', () => this.clients.delete(ws))
  }

  broadcast(msg: unknown) {
    const data = JSON.stringify(msg)
    for (const c of this.clients) if (c.readyState === 1) c.send(data)
  }

  ping() {
    for (const c of this.clients) if (c.readyState === 1) c.ping()
  }

  get size() {
    return this.clients.size
  }
}

export async function createHub(redisUrl?: string): Promise<Broadcaster> {
  if (!redisUrl) return new Hub()
  try {
    const Redis = (await import('ioredis')).default
    const local = new Hub()
    const pub = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    })
    const sub = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    })
    const channel = 'celtto:events'
    await sub.subscribe(channel)
    sub.on('message', (_ch, message) => {
      for (const c of (local as any).clients as Set<WebSocket>) {
        if (c.readyState === 1) c.send(message)
      }
    })
    pub.on('error', (e) => console.error('redis pub', e.message))
    sub.on('error', (e) => console.error('redis sub', e.message))
    return {
      mode: 'redis',
      add: (ws) => local.add(ws),
      broadcast: (msg) => {
        const data = JSON.stringify(msg)
        void pub.publish(channel, data)
      },
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
    return new Hub()
  }
}
