import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Button, Card, Field, inputCls } from '../ui'

type Desk = { id: number; sector_id: number; name: string; code: string; active: number }
type Sector = { id: number; name: string }

export default function Desks() {
  const [rows, setRows] = useState<Desk[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [sectorId, setSectorId] = useState<number | ''>('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    const sectorsData = await api<any[]>('/api/admin/sectors')
    setSectors(sectorsData.map((s: any) => ({ id: s.id, name: s.name })))
    setRows(await api<Desk[]>('/api/admin/desks'))
  }
  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    setErr('')
    try {
      if (!sectorId) throw new Error('Elegí secretaría')
      await api('/api/admin/desks', { method: 'POST', body: { sectorId, name, code } })
      setName('')
      setCode('')
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="display text-2xl font-semibold">Escritorios / Boxes</h1>
        <p className="text-sm text-muted">Puestos de atención por secretaría</p>
      </header>
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Secretaría">
            <select className={inputCls} value={sectorId} onChange={(e) => setSectorId(Number(e.target.value) || '')}>
              <option value="">Elegir…</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nombre">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Box 1" />
          </Field>
          <Field label="Código">
            <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="B1" />
          </Field>
          <Button onClick={() => void create()}>Agregar</Button>
        </div>
        {err && <p className="text-red-600 mt-2 text-sm">{err}</p>}
      </Card>
      <Card className="p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="py-2">Nombre</th>
              <th>Código</th>
              <th>Secretaría</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-line">
                <td className="py-2">{d.name}</td>
                <td className="font-mono">{d.code}</td>
                <td>{sectors.find((s) => s.id === d.sector_id)?.name || d.sector_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
