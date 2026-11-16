import { useEffect, useRef, useState } from 'react'
import type { CallTicket } from './api'

export type LiveMsg =
  | { type: 'hello' } | { type: 'config' } | { type: 'queue'; sectorIds: number[] }
  | { type: 'call'; recall: boolean; ticket: CallTicket }

export function useLive(onMsg: (m: LiveMsg) => void) {
  const cb = useRef(onMsg)
  cb.current = onMsg
  useEffect(() => {
    let ws: WebSocket | null = null, stop = false, retry = 0, timer: ReturnType<typeof setTimeout>
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      ws.onmessage = (e) => { try { cb.current(JSON.parse(e.data)) } catch {  } }
      ws.onopen = () => { if (retry > 0) cb.current({ type: 'config' }); retry = 0 }
      ws.onclose = () => { if (!stop) { retry++; timer = setTimeout(open, Math.min(1000 * 2 ** retry, 10000)) } }
    }
    open()
    return () => { stop = true; clearTimeout(timer); ws?.close() }
  }, [])
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = async () => {
    try { setData(await fnRef.current()); setError(null) } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, deps) 
  return { data, error, loading, reload, setData }
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}
