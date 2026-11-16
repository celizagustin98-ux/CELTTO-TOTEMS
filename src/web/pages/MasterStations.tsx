import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Button, Card, Field, inputCls } from '../ui'

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

export default function Stations() {
  const [rows, setRows] = useState<Station[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [kind, setKind] = useState<'totem' | 'tv'>('totem')
  const [name, setName] = useState('')
  const [sectorId, setSectorId] = useState<number | ''>('')
  const [err, setErr] = useState('')

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
    try {
      await api('/api/admin/stations', {
        method: 'POST',
        body: { kind, name, sectorId: sectorId || null },
      })
      setName('')
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="display text-2xl font-semibold">Tótems y TVs</h1>
        <p className="text-sm text-muted">Cada equipo se vincula a una secretaría. En el dispositivo usá el PIN de configuración.</p>
      </header>
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Tipo">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="totem">Tótem</option>
              <option value="tv">TV / Pantalla</option>
            </select>
          </Field>
          <Field label="Nombre">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tótem recepción" />
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
          <Button onClick={() => void create()}>Crear estación</Button>
        </div>
        {err && <p className="text-red-600 mt-2 text-sm">{err}</p>}
      </Card>
      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="py-2">Tipo</th>
              <th>Nombre</th>
              <th>Secretaría</th>
              <th>Device key</th>
              <th>Último uso</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <td className="py-2 uppercase text-xs font-semibold">{r.kind}</td>
                <td>{r.name}</td>
                <td>{r.sector_name || '—'}</td>
                <td className="font-mono text-xs">{r.device_key}</td>
                <td className="text-xs">{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
