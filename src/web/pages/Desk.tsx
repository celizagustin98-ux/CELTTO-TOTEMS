import { useCallback, useEffect, useState } from 'react'
import { ArrowRightLeft, BellRing, Check, LogOut, Megaphone, Play, UserX } from 'lucide-react'
import { useAuth } from '../auth'
import { api, type Stats } from '../lib/api'
import { elapsed, fmtMin, textOn, waitMin } from '../lib/format'
import { useLive, useNow } from '../lib/live'
import { Button, Card, ErrorBox, Modal, Spinner, useToast } from '../ui'

interface Current { id: number; code: string; status: 'called' | 'serving'; createdAt: string; calledAt: string | null; startedAt: string | null; recallCount: number; buttonLabel: string }
interface DeskState {
  user: { displayName: string; desk: string | null }; sector: { id: number; name: string; color: string }; current: Current | null
  waiting: { id: number; code: string; priority: number; createdAt: string; buttonLabel: string }[]
  stats: Stats; transferTargets: { id: number; name: string; color: string }[]
}

export default function Desk() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const now = useNow()
  const [st, setSt] = useState<DeskState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [transfer, setTransfer] = useState(false)

  const load = useCallback(async () => {
    try { setSt(await api<DeskState>('/api/desk/state')); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { void load(); const t = setInterval(load, 20000); return () => clearInterval(t) }, [load])
  useLive((m) => { if (m.type === 'config' || (m.type === 'queue' && (!st || m.sectorIds.includes(st.sector.id)))) void load() })

  const act = async (path: string, ok?: string) => {
    if (busy) return
    setBusy(true)
    try { setSt(await api<DeskState>(`/api/desk/${path}`, { method: 'POST' })); if (ok) toast(ok) } catch (e) { toast((e as Error).message, 'error'); void load() } finally { setBusy(false) }
  }
  const doTransfer = async (sectorId: number) => {
    setBusy(true)
    try { setSt(await api<DeskState>('/api/desk/transfer', { body: { sectorId } })); setTransfer(false); toast('Turno derivado') } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }

  if (!st) return error ? <div className="p-6"><ErrorBox msg={error} retry={load} /></div> : <Spinner />
  const { sector, current, waiting, stats } = st
  const fg = textOn(sector.color)
  const next = waiting[0]

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-4 px-5 py-3.5 sm:px-8" style={{ background: sector.color, color: fg }}>
        <div className="min-w-0 flex-1">
          <div className="display truncate text-xl font-semibold">{sector.name}{st.user.desk ? ` · ${st.user.desk}` : ''}</div>
          <div className="truncate text-sm opacity-80">{user?.displayName}</div>
        </div>
        <button onClick={logout} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/10"><LogOut size={17} />Salir</button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 p-5 sm:p-8">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['En espera', stats.waiting], ['Atendidos hoy', stats.done], ['Ausentes', stats.absent], ['Espera promedio', fmtMin(stats.avgWaitMin)]].map(([l, v]) => (
            <Card key={l as string} className="px-4 py-3"><dt className="text-sm text-muted">{l}</dt><dd className="num text-3xl leading-tight">{v}</dd></Card>
          ))}
        </dl>

        <div className="grid items-start gap-5 lg:grid-cols-[1.25fr_1fr]">
          {current ? (
            <div className="stub bg-white shadow-sm ring-1 ring-line" style={{ ['--notch' as string]: '68%' }}>
              <div className="px-6 pb-8 pt-6 text-white" style={{ background: sector.color, color: fg }}>
                <div className="flex items-center justify-between text-sm opacity-85"><span>{current.status === 'called' ? 'Llamado' : 'En atención'}{current.recallCount > 0 ? ` · ${current.recallCount} ${current.recallCount === 1 ? 'rellamado' : 'rellamados'}` : ''}</span><span className="num text-xl">{elapsed(current.status === 'serving' ? current.startedAt : current.calledAt, now)}</span></div>
                <div className="num mt-2 text-[clamp(5rem,14vw,9rem)] leading-[0.9]">{current.code}</div>
                <div className="mt-2 text-lg opacity-90">{current.buttonLabel} · espera {waitMin(current.createdAt, Date.parse(current.calledAt ?? current.createdAt))} min</div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-dashed border-line px-5 py-4">
                {current.status === 'called' ? (
                  <>
                    <Button size="lg" onClick={() => act('start')} disabled={busy}><Play size={18} />Iniciar atención</Button>
                    <Button size="lg" variant="soft" onClick={() => act('recall', 'Volviste a llamar')} disabled={busy}><BellRing size={18} />Volver a llamar</Button>
                    <Button size="lg" variant="danger" onClick={() => act('absent')} disabled={busy}><UserX size={18} />No se presentó</Button>
                  </>
                ) : (
                  <Button size="lg" onClick={() => act('finish', 'Atención finalizada')} disabled={busy}><Check size={18} />Finalizar</Button>
                )}
                <Button size="lg" variant="soft" onClick={() => setTransfer(true)} disabled={busy || st.transferTargets.length === 0}><ArrowRightLeft size={18} />Derivar</Button>
              </div>
            </div>
          ) : (
            <Card className="px-6 py-10 text-center">
              <div className="display text-2xl font-semibold">{next ? 'Listo para llamar' : 'No hay turnos en espera'}</div>
              <p className="mx-auto mt-1 max-w-sm text-muted">{next ? <>Sigue el <span className="font-semibold text-ink">{next.code}</span> ({next.buttonLabel}).</> : 'Cuando alguien saque un turno, aparece acá al instante.'}</p>
              <Button size="lg" className="mt-6 px-10" onClick={() => act('call-next')} disabled={busy || !next}><Megaphone size={20} />Llamar siguiente</Button>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5"><h2 className="display text-lg font-semibold">En espera</h2><span className="num text-2xl">{waiting.length}</span></div>
            {waiting.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">La cola está vacía.</p> : (
              <ul className="max-h-[28rem] divide-y divide-line overflow-auto">
                {waiting.map((w, i) => (
                  <li key={w.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="num w-20 text-2xl">{w.code}</span>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm">{w.buttonLabel}</div><div className="text-xs text-muted">{waitMin(w.createdAt, now)} min{w.priority > 0 ? ' · prioridad' : ''}{i === 0 ? ' · sigue' : ''}</div></div>
                    <Button variant="soft" size="sm" onClick={() => act(`call/${w.id}`)} disabled={busy || !!current}>Llamar</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </main>

      {transfer && (
        <Modal title="Derivar turno" onClose={() => setTransfer(false)}>
          <p className="text-sm text-muted">El turno {current?.code} pasa a la cola de la secretaría que elijas, conservando su número.</p>
          <div className="grid gap-2">
            {st.transferTargets.map((t) => <button key={t.id} onClick={() => doTransfer(t.id)} disabled={busy} className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-left font-medium hover:bg-paper"><span className="h-4 w-4 rounded-sm" style={{ background: t.color }} />{t.name}</button>)}
          </div>
        </Modal>
      )}
    </div>
  )
}
