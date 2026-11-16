import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Button, Card, Field, inputCls } from '../ui'

type Priority = { id: number; name: string; weight: number; color: string | null; sort_order: number; active: number }

export default function Priorities() {
  const [rows, setRows] = useState<Priority[]>([])
  const [name, setName] = useState('')
  const [weight, setWeight] = useState(0)
  const [color, setColor] = useState('#64748b')
  const [err, setErr] = useState('')

  const load = async () => setRows(await api<Priority[]>('/api/admin/priorities'))
  useEffect(() => {
    void load()
  }, [])

  const create = async () => {
    setErr('')
    try {
      await api('/api/admin/priorities', { method: 'POST', body: { name, weight, color } })
      setName('')
      setWeight(0)
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const toggle = async (p: Priority) => {
    await api(`/api/admin/priorities/${p.id}`, { method: 'PUT', body: { active: !p.active } })
    await load()
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="display text-2xl font-semibold">Prioridades</h1>
        <p className="text-sm text-muted">Definí niveles de prioridad. Los botones del tótem usan estos pesos para ordenar la cola.</p>
      </header>
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Nombre">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Preferencial" />
          </Field>
          <Field label="Peso (mayor = antes)">
            <input className={inputCls} type="number" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
          </Field>
          <Field label="Color">
            <input className={inputCls} type="color" value={color} onChange={(e) => setColor(e.target.value)} />
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
              <th>Peso</th>
              <th>Color</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-line">
                <td className="py-2 font-medium">{p.name}</td>
                <td>{p.weight}</td>
                <td>
                  <span className="inline-block w-4 h-4 rounded" style={{ background: p.color || '#ccc' }} />
                </td>
                <td>{p.active ? 'Activa' : 'Inactiva'}</td>
                <td>
                  <button type="button" className="text-brand" onClick={() => void toggle(p)}>
                    {p.active ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
