import { useEffect, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { api } from '../lib/api'
import { Button, Card, Field, inputCls, useToast } from '../ui'

type Station = {
  id: number
  kind: 'totem' | 'tv'
  name: string
  sector_id: number | null
  sector_name?: string | null
  device_key: string
  active: number
  last_seen_at: string | null
}
type Sector = { id: number; name: string }

function stationUrl(kind: 'totem' | 'tv', deviceKey: string) {
  return `${location.origin}/${kind}/${encodeURIComponent(deviceKey)}`
}

export default function Stations() {
  const toast = useToast()
  const [rows, setRows] = useState<Station[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [kind, setKind] = useState<'totem' | 'tv'>('totem')
  const [name, setName] = useState('')
  const [sectorId, setSectorId] = useState<number | ''>('')
  const [err, setErr] = useState('')
  const [lastCreated, setLastCreated] = useState<{ url: string; kind: string; name: string } | null>(null)

  const load = async () => {
    const sectorsData = await api<any[]>('/api/admin/sectors')
    setSectors(sectorsData.map((s: any) => ({ id: s.id, name: s.name })))
    setRows(await api<Station[]>('/api/admin/stations'))
  }
  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    setErr('')
    if (!name.trim()) {
      setErr('Ingresá un nombre')
      return
    }
    try {
      const res = await api<{ id: number; deviceKey: string }>('/api/admin/stations', {
        method: 'POST',
        body: { kind, name: name.trim(), sectorId: sectorId || null },
      })
      const url = stationUrl(kind, res.deviceKey)
      setLastCreated({ url, kind, name: name.trim() })
      setName('')
      await load()
      toast('Estación creada — copiá la URL al dispositivo')
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('URL copiada')
    } catch {
      toast('No se pudo copiar', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="display text-2xl font-semibold">Tótems y TVs</h1>
        <p className="text-sm text-muted">
          Al crear una estación se genera una <strong>URL fija</strong>. Pegala en el navegador del tótem o de la TV (modo kiosk) y siempre abre esa pantalla con su secretaría.
        </p>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Tipo">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="totem">Tótem</option>
              <option value="tv">TV / Llamador de pantalla</option>
            </select>
          </Field>
          <Field label="Nombre">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tótem Secretaría Azul" />
          </Field>
          <Field label="Secretaría">
            <select className={inputCls} value={sectorId} onChange={(e) => setSectorId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Sin asignar</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={() => void create()}>Crear y generar URL</Button>
        </div>
        {err && <p className="text-red-600 mt-2 text-sm">{err}</p>}
      </Card>

      {lastCreated && (
        <Card className="border-emerald-300 bg-emerald-50 p-4">
          <div className="text-sm font-medium text-emerald-900">URL de {lastCreated.kind === 'totem' ? 'tótem' : 'TV'}: {lastCreated.name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded bg-white px-3 py-2 text-sm break-all">{lastCreated.url}</code>
            <Button size="sm" variant="soft" onClick={() => void copy(lastCreated.url)}>
              <Copy size={16} /> Copiar
            </Button>
            <a href={lastCreated.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-emerald-800 underline">
              <ExternalLink size={14} /> Abrir
            </a>
          </div>
        </Card>
      )}

      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="py-2">Tipo</th>
              <th>Nombre</th>
              <th>Secretaría</th>
              <th>URL fija</th>
              <th>Último uso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const url = stationUrl(r.kind, r.device_key)
              return (
                <tr key={r.id} className="border-b border-line">
                  <td className="py-2 uppercase text-xs font-semibold">{r.kind}</td>
                  <td>{r.name}</td>
                  <td>{r.sector_name || '—'}</td>
                  <td className="font-mono text-xs max-w-xs truncate" title={url}>
                    /{r.kind}/{r.device_key}
                  </td>
                  <td className="text-xs">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : '—'}</td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => void copy(url)} aria-label="Copiar URL">
                        <Copy size={15} />
                      </Button>
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center p-2 text-muted hover:text-ink">
                        <ExternalLink size={15} />
                      </a>
                    </div>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  Todavía no hay estaciones. Creá un tótem o TV y copiá su URL.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
