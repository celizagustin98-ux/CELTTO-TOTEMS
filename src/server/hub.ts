import type { WebSocket } from 'ws'

export type Broadcaster = { broadcast(msg: unknown): void; size: number; ping(): void; add(ws: WebSocket): void; close?(): Promise<void> }

export class Hub implements Broadcaster {
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
    const pub = new Redis(redisUrl)
    const sub = new Redis(redisUrl)
    const channel = 'celtto:events'
    await sub.subscribe(channel)
    sub.on('message', (_ch, message) => {
      for (const c of (local as any).clients as Set<WebSocket>) {
        if (c.readyState === 1) c.send(message)
      }
    })
    return {
      add: (ws) => local.add(ws),
      broadcast: (msg) => {
        const data = JSON.stringify(msg)
        void pub.publish(channel, data)
        local.broadcast(msg)
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
  } catch {
    return new Hub()
  }
}
