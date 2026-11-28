import { useEffect, useState } from 'react'
import { ExternalLink, GripVertical, Layers, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, type Btn, type Priority, type Sector } from '../lib/api'
import { PALETTE, textOn } from '../lib/format'
import { useLoad } from '../lib/live'
import { BUTTON_ICONS, ButtonIcon } from '../components/Icons'
import { useAuth, MANAGERS } from '../auth'
import { Button, Card, ColorPicker, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, inputCls, useConfirm, useToast } from '../ui'

type SectorForm = { id?: number; name: string; color: string; welcomeMessage: string }
type BtnForm = { id?: number; sectorId: number; targetSectorId: number; label: string; subtitle: string; color: string; icon: string; prefix: string; priorityId: number | null }

export default function Sectors() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const canEdit = !!user && MANAGERS.includes(user.role)
  const { data, error, loading, reload, setData } = useLoad(() => api<Sector[]>('/api/admin/sectors'))
  const prios = useLoad(() => api<Priority[]>('/api/admin/priorities'))
  const pub = useLoad(() => api<{ settings: { priorities_enabled: boolean } }>('/api/public/sectors'))
  const prioOn = !!pub.data?.settings.priorities_enabled
  const [sf, setSf] = useState<SectorForm | null>(null)
  const [bf, setBf] = useState<BtnForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ sectorId: number; id: number } | null>(null)

  useEffect(() => {
    if (data?.length && !data.some((s) => s.id === previewId)) setPreviewId(data[0].id)
  }, [data, previewId])

  const run = async (fn: () => Promise<unknown>, ok: string, close: () => void) => {
    setBusy(true)
    try {
      await fn()
      toast(ok)
      close()
      await reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const saveSector = () =>
    run(
      () => {
        const body = { name: sf!.name, color: sf!.color, welcomeMessage: sf!.welcomeMessage || null }
        return sf!.id ? api(`/api/admin/sectors/${sf!.id}`, { method: 'PUT', body }) : api('/api/admin/sectors', { body })
      },
      'Secretaría guardada',
      () => setSf(null),
    )
  const saveBtn = () =>
    run(
      () => {
        const b = bf!
        const body = { sectorId: b.sectorId, targetSectorId: b.targetSectorId, label: b.label, subtitle: b.subtitle || null, color: b.color || null, icon: b.icon || null, prefix: b.prefix, priorityId: b.priorityId }
        return b.id ? api(`/api/admin/buttons/${b.id}`, { method: 'PUT', body }) : api('/api/admin/buttons', { body })
      },
      'Botón guardado',
      () => setBf(null),
    )
  const delSector = async (s: Sector) => {
    if (await confirm({ title: 'Eliminar secretaría', message: <>Se elimina <b>{s.name}</b> con sus botones y escritorios. Los usuarios quedan sin secretaría asignada.</>, confirmLabel: 'Eliminar', danger: true }))
      void run(() => api(`/api/admin/sectors/${s.id}`, { method: 'DELETE' }), 'Secretaría eliminada', () => {})
  }
  const delBtn = async (b: Btn) => {
    if (await confirm({ title: 'Eliminar botón', message: <>El botón <b>{b.label}</b> deja de aparecer en el tótem.</>, confirmLabel: 'Eliminar', danger: true }))
      void run(() => api(`/api/admin/buttons/${b.id}`, { method: 'DELETE' }), 'Botón eliminado', () => {})
  }
  const defaultPrio = () => prios.data?.find((p) => p.active && p.weight === Math.min(...prios.data!.filter((x) => x.active).map((x) => x.weight)))?.id ?? null
  const newBtn = (s: Sector) => setBf({ sectorId: s.id, targetSectorId: s.id, label: '', subtitle: '', color: '', icon: 'ticket', prefix: '', priorityId: defaultPrio() })

  /** Reordenar botones arrastrando. Se aplica al instante y se guarda en el servidor. */
  const dropOn = async (sector: Sector, targetId: number) => {
    if (!drag || drag.sectorId !== sector.id || drag.id === targetId) return setDrag(null)
    const ids = sector.buttons.map((b) => b.id)
    const from = ids.indexOf(drag.id)
    const to = ids.indexOf(targetId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDrag(null)
    setData((d) => d && d.map((s) => (s.id === sector.id ? { ...s, buttons: ids.map((id) => s.buttons.find((b) => b.id === id)!) } : s)))
    try {
      await api('/api/admin/buttons/order', { method: 'PUT', body: { sectorId: sector.id, ids } })
      toast('Orden guardado')
    } catch (e) {
      toast((e as Error).message, 'error')
      void reload()
    }
  }

  if (loading) return <Spinner />
  if (error) return <ErrorBox msg={error} retry={reload} />
  const sectors = data!
  const priorities = (prios.data ?? []).filter((p) => p.active)
  const prioOf = (b: { priorityId: number | null }) => (prioOn ? priorities.find((p) => p.id === b.priorityId) : undefined)
  const preview = sectors.find((s) => s.id === previewId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Secretarías y botones"
        description="Cada secretaría tiene su cola y sus botones. Cada botón que toca el paciente genera un turno. Arrastrá los botones para cambiar el orden en el tótem."
        actions={
          canEdit && (
            <Button onClick={() => setSf({ name: '', color: PALETTE[sectors.length % PALETTE.length], welcomeMessage: '' })}>
              <Plus size={18} />
              Nueva secretaría
            </Button>
          )
        }
      />
      {sectors.length === 0 && <Empty icon={<Layers size={22} />} title="Creá tu primera secretaría" hint="Por ejemplo “Secretaría A”, con los botones “Turno nuevo” y “Continuar atención”." />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="grid content-start gap-5 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {sectors.map((s) => (
            <Card key={s.id} className={`overflow-hidden transition-shadow ${previewId === s.id ? 'ring-2 ring-brand/50' : ''}`}>
              <div className="flex items-center gap-3 px-5 py-4" style={{ background: s.color, color: textOn(s.color) }} onClick={() => setPreviewId(s.id)}>
                <h2 className="display flex-1 truncate text-xl font-semibold">{s.name}</h2>
                {canEdit && (
                  <>
                    <button aria-label={`Editar ${s.name}`} onClick={() => setSf({ id: s.id, name: s.name, color: s.color, welcomeMessage: s.welcomeMessage ?? '' })} className="rounded-md p-1.5 hover:bg-black/10">
                      <Pencil size={17} />
                    </button>
                    <button aria-label={`Eliminar ${s.name}`} onClick={() => delSector(s)} className="rounded-md p-1.5 hover:bg-black/10">
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </div>
              <ul className="divide-y divide-line">
                {s.buttons.map((b) => {
                  const dest = sectors.find((x) => x.id === b.targetSectorId)
                  const p = prioOf(b)
                  const c = b.color ?? s.color
                  return (
                    <li
                      key={b.id}
                      draggable={canEdit}
                      onDragStart={() => setDrag({ sectorId: s.id, id: b.id })}
                      onDragOver={(e) => drag?.sectorId === s.id && e.preventDefault()}
                      onDrop={() => dropOn(s, b.id)}
                      onDragEnd={() => setDrag(null)}
                      className={`flex items-center gap-3 px-3 py-3 ${drag?.id === b.id ? 'opacity-40' : ''}`}
                    >
                      {canEdit && <GripVertical size={16} className="shrink-0 cursor-grab text-muted/60" aria-label="Arrastrar para ordenar" />}
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg" style={{ background: c, color: textOn(c) }}>
                        <ButtonIcon name={b.icon} size={20} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{b.label}</span>
                          <span className="num rounded bg-paper px-1.5 text-sm text-muted">{b.prefix}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {p && (
                            <span className="badge" style={{ background: `${p.color ?? '#64748b'}22`, color: p.color ?? '#64748b' }}>
                              {p.name}
                            </span>
                          )}
                          {dest && dest.id !== s.id && <span>→ va a {dest.name}</span>}
                          {!prioOn && (b.priority ?? 0) > 0 && <span className="badge badge-muted" title="Las prioridades están desactivadas en Configuración">Oculto en el tótem</span>}
                        </div>
                      </div>
                      {canEdit && (
                        <>
                          <button aria-label={`Editar ${b.label}`} onClick={() => setBf({ id: b.id, sectorId: b.sectorId, targetSectorId: b.targetSectorId, label: b.label, subtitle: b.subtitle ?? '', color: b.color ?? '', icon: b.icon ?? 'ticket', prefix: b.prefix, priorityId: b.priorityId })} className="rounded-md p-1.5 text-muted hover:bg-paper">
                            <Pencil size={16} />
                          </button>
                          <button aria-label={`Eliminar ${b.label}`} onClick={() => delBtn(b)} className="rounded-md p-1.5 text-muted hover:bg-paper">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </li>
                  )
                })}
                {s.buttons.length === 0 && <li className="px-5 py-4 text-sm text-muted">Esta secretaría todavía no tiene botones.</li>}
              </ul>
              <div className="flex items-center justify-between border-t border-line p-3">
                {canEdit ? (
                  <Button variant="soft" size="sm" onClick={() => newBtn(s)}>
                    <Plus size={16} />
                    Agregar botón
                  </Button>
                ) : (
                  <span />
                )}
                <Button variant="ghost" size="sm" onClick={() => setPreviewId(s.id)}>
                  Ver en el tótem
                </Button>
              </div>
            </Card>
          ))}
        </div>

        {preview && (
          <aside className="xl:sticky xl:top-6 xl:self-start">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted">Vista previa del tótem</h2>
              <a href="/totem" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
                <ExternalLink size={13} /> Abrir
              </a>
            </div>
            <TotemPreview sector={prioOn ? preview : { ...preview, buttons: preview.buttons.filter((b) => (b.priority ?? 0) <= 0) }} priorities={prioOn ? priorities : []} />
            <p className="mt-2 text-xs text-muted">Así ve el paciente la pantalla. Se actualiza al guardar cambios.</p>
          </aside>
        )}
      </div>

      {sf && (
        <Modal
          title={sf.id ? 'Editar secretaría' : 'Nueva secretaría'}
          onClose={() => setSf(null)}
          footer={
            <>
              <Button variant="soft" onClick={() => setSf(null)}>Cancelar</Button>
              <Button onClick={saveSector} disabled={busy || !sf.name.trim()}>Guardar</Button>
            </>
          }
        >
          <Field label="Nombre">
            <input className={inputCls} value={sf.name} onChange={(e) => setSf({ ...sf, name: e.target.value })} placeholder="Secretaría A" autoFocus />
          </Field>
          <Field label="Color de la secretaría" hint="Es el color que se ve en el tótem y en la pantalla cuando llaman.">
            <ColorPicker value={sf.color} onChange={(color) => setSf({ ...sf, color })} />
          </Field>
          <Field label="Mensaje de bienvenida del tótem" hint="Opcional.">
            <input className={inputCls} value={sf.welcomeMessage} onChange={(e) => setSf({ ...sf, welcomeMessage: e.target.value })} placeholder="Bienvenido. Tocá una opción para sacar tu turno." />
          </Field>
        </Modal>
      )}

      {bf && (
        <Modal
          wide
          title={bf.id ? 'Editar botón' : 'Nuevo botón'}
          onClose={() => setBf(null)}
          footer={
            <>
              <Button variant="soft" onClick={() => setBf(null)}>Cancelar</Button>
              <Button onClick={saveBtn} disabled={busy || !bf.label.trim() || !bf.prefix.trim()}>Guardar</Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div className="space-y-4">
              <Field label="Texto del botón">
                <input className={inputCls} value={bf.label} onChange={(e) => setBf({ ...bf, label: e.target.value })} placeholder="Turno nuevo" autoFocus />
              </Field>
              <Field label="Descripción" hint="Opcional. Se muestra debajo del texto.">
                <input className={inputCls} value={bf.subtitle} onChange={(e) => setBf({ ...bf, subtitle: e.target.value })} />
              </Field>
            </div>
            <ButtonPreview f={bf} sectorColor={sectors.find((x) => x.id === bf.sectorId)?.color ?? '#2f6fed'} prio={prioOf(bf)} />
          </div>
          <div className={`grid gap-4 ${prioOn ? 'grid-cols-2' : 'grid-cols-1 sm:max-w-xs'}`}>
            <Field label="Letra del turno" hint="Genera A-001, A-002…">
              <input className={`${inputCls} uppercase`} maxLength={3} value={bf.prefix} onChange={(e) => setBf({ ...bf, prefix: e.target.value.replace(/[^a-zA-Z0-9]/g, '') })} placeholder="A" />
            </Field>
            {prioOn && <Field label="Prioridad" hint="Las de mayor peso pasan adelante en la cola.">
              <select className={inputCls} value={bf.priorityId ?? ''} onChange={(e) => setBf({ ...bf, priorityId: e.target.value ? Number(e.target.value) : null })}>
                {priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (peso {p.weight})
                  </option>
                ))}
              </select>
            </Field>}
          </div>
          <Field label="Ícono">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(BUTTON_ICONS).map(([k, v]) => (
                <button key={k} type="button" title={v.label} aria-label={v.label} aria-pressed={bf.icon === k} onClick={() => setBf({ ...bf, icon: k })} className={`grid h-10 w-10 place-items-center rounded-lg border transition ${bf.icon === k ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:bg-paper'}`}>
                  <v.icon size={18} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Cola de destino" hint="Normalmente es la misma secretaría. Cambiala si este botón envía al paciente a otra.">
            <select className={inputCls} value={bf.targetSectorId} onChange={(e) => setBf({ ...bf, targetSectorId: Number(e.target.value) })}>
              {sectors.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Color propio" hint="Opcional. Si no elegís uno, usa el de la secretaría.">
            <div className="flex items-center gap-3">
              <ColorPicker value={bf.color || sectors.find((x) => x.id === bf.sectorId)?.color || '#2f6fed'} onChange={(color) => setBf({ ...bf, color })} />
              {bf.color && <Button variant="ghost" size="sm" onClick={() => setBf({ ...bf, color: '' })}>Quitar</Button>}
            </div>
          </Field>
        </Modal>
      )}
    </div>
  )
}

function ButtonPreview({ f, sectorColor, prio }: { f: BtnForm; sectorColor: string; prio?: Priority }) {
  const c = f.color || sectorColor
  return (
    <div className="flex aspect-[4/3] flex-col justify-between rounded-2xl p-4 shadow-md" style={{ background: `linear-gradient(145deg, ${c}, color-mix(in srgb, ${c} 78%, black))`, color: textOn(c) }} aria-label="Vista previa del botón">
      <div className="flex items-start justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/20"><ButtonIcon name={f.icon} size={18} /></span>
        {prio && prio.weight > 0 && <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-semibold">{prio.name}</span>}
      </div>
      <div>
        <div className="display text-lg font-semibold leading-tight">{f.label || 'Texto del botón'}</div>
        {f.subtitle && <div className="text-xs opacity-85">{f.subtitle}</div>}
      </div>
    </div>
  )
}

/** Miniatura del tótem real con los botones de la secretaría. */
function TotemPreview({ sector, priorities }: { sector: Sector; priorities: Priority[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border-8 border-slate-800 bg-night text-white shadow-xl">
      <div className="relative p-4" style={{ background: `radial-gradient(ellipse at 10% -20%, ${sector.color}66, transparent 60%)` }}>
        <div className="text-[9px] uppercase tracking-[0.18em] text-white/50">Tótem</div>
        <div className="display text-lg font-semibold">{sector.name}</div>
        <p className="mt-1 text-[11px] text-white/70">{sector.welcomeMessage || 'Tocá una opción para sacar tu turno'}</p>
        <div className={`mt-3 grid gap-2 ${sector.buttons.length > 1 ? 'grid-cols-2' : ''}`}>
          {sector.buttons.map((b) => {
            const c = b.color ?? sector.color
            const p = priorities.find((x) => x.id === b.priorityId)
            return (
              <div key={b.id} className="flex min-h-24 flex-col justify-between rounded-xl p-2.5" style={{ background: `linear-gradient(145deg, ${c}, color-mix(in srgb, ${c} 78%, black))`, color: textOn(c) }}>
                <div className="flex items-start justify-between">
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-white/20"><ButtonIcon name={b.icon} size={14} /></span>
                  {p && p.weight > 0 && <span className="rounded-full bg-black/20 px-1.5 text-[8px] font-semibold">{p.name}</span>}
                </div>
                <div>
                  <div className="text-[12px] font-semibold leading-tight">{b.label}</div>
                  {b.subtitle && <div className="line-clamp-2 text-[9px] opacity-80">{b.subtitle}</div>}
                </div>
              </div>
            )
          })}
          {sector.buttons.length === 0 && <div className="rounded-xl border border-dashed border-white/20 p-4 text-center text-[11px] text-white/50">Sin botones</div>}
        </div>
      </div>
    </div>
  )
}
