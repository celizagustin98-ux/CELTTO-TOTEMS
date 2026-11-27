import { useEffect, useRef, useState } from 'react'
import type { CallTicket } from './api'

export type LiveMsg =
  | { type: 'hello' }
  | { type: 'config' }
  | { type: 'queue'; sectorIds: number[] }
  | { type: 'call'; recall: boolean; ticket: CallTicket }

/**
 * Conexión en vivo (WebSocket) con reconexión automática.
 * Devuelve si está conectado, para mostrar el indicador en tótem/TV/paneles.
 */
export function useLive(onMsg: (m: LiveMsg) => void) {
  const cb = useRef(onMsg)
  cb.current = onMsg
  const [connected, setConnected] = useState(true)
  useEffect(() => {
    let ws: WebSocket | null = null
    let stop = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout>
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
      ws.onmessage = (e) => {
        try {
          cb.current(JSON.parse(e.data))
        } catch {
          /* mensaje inválido */
        }
      }
      ws.onopen = () => {
        setConnected(true)
        // Al reconectar se pide recargar: pudo haber cambios mientras estuvo caído
        if (retry > 0) cb.current({ type: 'config' })
        retry = 0
      }
      ws.onclose = () => {
        if (stop) return
        setConnected(false)
        retry++
        timer = setTimeout(open, Math.min(1000 * 2 ** retry, 15000))
      }
    }
    open()
    return () => {
      stop = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [])
  return connected
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = async () => {
    try {
      setData(await fnRef.current())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void reload()
  }, deps)
  return { data, error, loading, reload, setData }
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Ejecuta `fn` como máximo una vez cada `ms` (agrupa ráfagas de eventos en una sola recarga). */
export function useDebounced(fn: () => void, ms = 300) {
  const ref = useRef(fn)
  ref.current = fn
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  return () => {
    clearTimeout(t.current)
    t.current = setTimeout(() => ref.current(), ms)
  }
}

/** Devuelve true cuando no hubo interacción (toque, tecla, mouse) durante `ms`. */
export function useIdle(ms: number, enabled = true) {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setIdle(false)
      return
    }
    let t: ReturnType<typeof setTimeout>
    const reset = () => {
      setIdle(false)
      clearTimeout(t)
      t = setTimeout(() => setIdle(true), ms)
    }
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(t)
      evs.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [ms, enabled])
  return idle
}
