import type { WebSocket } from 'ws'

export class Hub {
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
  ping() { for (const c of this.clients) if (c.readyState === 1) c.ping() }
  get size() { return this.clients.size }
}
