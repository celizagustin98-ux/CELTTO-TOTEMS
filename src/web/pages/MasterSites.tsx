import { useState } from 'react'
import { Building2, MapPin, Pencil, Plus } from 'lucide-react'
import { api, type Sector } from '../lib/api'
import { useLoad } from '../lib/live'
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Toggle, inputCls, useToast } from '../ui'

type Site = { id: number; name: string; code: string; address: string | null; active: boolean }
type Form = { id?: number; name: string; code: string; address: string; active: boolean }

export default function Sites() {
  const toast = useToast()
  const sites = useLoad(() => api<Site[]>('/api/admin/sites'))
  const sectors = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const [f, setF] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!f) return
    setBusy(true)
    try {
      const body = { name: f.name, code: f.code, address: f.address || null, active: f.active }
      if (f.id) await api(`/api/admin/sites/${f.id}`, { method: 'PUT', body })
      else await api('/api/admin/sites', { body })
      toast('Sede guardada')
      setF(null)
      await sites.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  if (sites.loading) return <Spinner />
  if (sites.error) return <ErrorBox msg={sites.error} retry={sites.reload} />
  const list = sites.data!
  const secs = sectors.data ?? []
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sedes"
        description="Si la institución tiene varias sedes, cada secretaría pertenece a una. Los reportes y supervisores se pueden organizar por sede."
        actions={<Button onClick={() => setF({ name: '', code: '', address: '', active: true })}><Plus size={17} /> Nueva sede</Button>}
      />
      {list.length === 0 ? (
        <Empty icon={<Building2 size={22} />} title="No hay sedes" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const mine = secs.filter((x) => x.siteId === s.id)
            return (
              <div key={s.id} className={`surface card-hover p-5 ${s.active ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><Building2 size={19} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{s.name}</div>
                    <div className="font-mono text-[12px] text-muted">{s.code}</div>
                  </div>
                  {!s.active && <span className="badge badge-muted">Inactiva</span>}
                  <button aria-label={`Editar ${s.name}`} onClick={() => setF({ id: s.id, name: s.name, code: s.code, address: s.address ?? '', active: s.active })} className="rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink"><Pencil size={15} /></button>
                </div>
                {s.address && <div className="mt-3 flex items-center gap-1.5 text-[13px] text-muted"><MapPin size={14} /> {s.address}</div>}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {mine.length ? mine.map((x) => <span key={x.id} className="badge" style={{ background: `${x.color}22`, color: x.color }}>{x.name}</span>) : <span className="text-[13px] text-muted">Sin secretarías</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {f && (
        <Modal title={f.id ? 'Editar sede' : 'Nueva sede'} onClose={() => setF(null)} footer={<><Button variant="soft" onClick={() => setF(null)}>Cancelar</Button><Button onClick={save} disabled={busy || !f.name.trim() || f.code.length < 2}>Guardar</Button></>}>
          <Field label="Nombre"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sede Centro" autoFocus /></Field>
          <Field label="Código" hint="Corto y sin espacios (ej.: centro, norte)."><input className={inputCls} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></Field>
          <Field label="Dirección"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          {f.id && <Toggle checked={f.active} onChange={(active) => setF({ ...f, active })} label="Sede activa" />}
        </Modal>
      )}
    </div>
  )
}
