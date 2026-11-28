import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, BellRing, Bell, BellOff, Check, Keyboard, LogOut, Megaphone, Minimize2, Maximize2, Play, UserX, WifiOff, IdCard, Phone, StickyNote, UserRound, Pencil, UserCog, HeartPulse } from 'lucide-react'
import { useAuth } from '../auth'
import { api, type Stats } from '../lib/api'
import { elapsed, fmtMin, textOn, waitLevel, waitMin } from '../lib/format'
import { useDebounced, useLive, useNow } from '../lib/live'
import { Avatar, Button, Card, ErrorBox, Field, Kbd, Modal, Spinner, ThemeToggle, inputCls, useConfirm, useHotkeys, useToast } from '../ui'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

interface Current { id: number; code: string; status: 'called' | 'serving'; createdAt: string; calledAt: string | null; startedAt: string | null; recallCount: number; buttonLabel: string; dni: string | null; patient: { id: number; name: string; document: string; documentType: string; visits: number; phone: string | null; notes: string | null; healthInsurance: string | null; insuranceNumber: string | null } | null }
interface Waiting { id: number; code: string; priority: number; priorityName: string | null; priorityColor: string | null; createdAt: string; buttonLabel: string; patientName: string | null }
interface DeskState {
  user: { displayName: string; desk: string | null; deskId: number | null }
  sector: { id: number; name: string; color: string }
  current: Current | null
  waiting: Waiting[]
  stats: Stats
  transferTargets: { id: number; name: string; color: string }[]
  desks: { id: number; name: string; code: string }[]
  thresholds: { warn: number; danger: number }
}

const pref = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k)
    return v === null ? d : v === '1'
  } catch {
    return d
  }
}
const savePref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0')
  } catch {
    /* sin almacenamiento */
  }
}

/** Tono corto para avisar que entró un turno con la cola vacía. */
function beep() {
  try {
    const c = new AudioContext()
    const o = c.createOscillator()
    const g = c.createGain()
    o.frequency.value = 740
    g.gain.setValueAtTime(0.0001, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35)
    o.connect(g).connect(c.destination)
    o.start()
    o.stop(c.currentTime + 0.4)
    setTimeout(() => void c.close(), 600)
  } catch {
    /* sin audio */
  }
}

const LEVEL = {
  ok: 'text-ok bg-ok-soft',
  warn: 'text-warn bg-warn-soft',
  danger: 'text-danger bg-danger-soft',
} as const

export default function Desk() {
  const { t } = useTranslation()
  const [pf, setPf] = useState<{ phone: string; healthInsurance: string; insuranceNumber: string; notes: string } | null>(null)
  const { user, logout, refresh } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const now = useNow()
  const [st, setSt] = useState<DeskState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [transfer, setTransfer] = useState(false)
  const [help, setHelp] = useState(false)
  const [compact, setCompact] = useState(() => pref('celtto.desk.compact', false))
  const [sound, setSound] = useState(() => pref('celtto.desk.sound', true))
  const prevWaiting = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      setSt(await api<DeskState>('/api/desk/state'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  const reloadSoon = useDebounced(load, 250)
  useEffect(() => {
    void load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])
  const connected = useLive((m) => {
    if (m.type === 'config' || (m.type === 'queue' && (!st || !m.sectorIds?.length || m.sectorIds.includes(st.sector.id)))) reloadSoon()
  })

  // Aviso sonoro: la cola estaba vacía y llegó alguien
  useEffect(() => {
    if (!st) return
    const n = st.waiting.length
    if (sound && prevWaiting.current === 0 && n > 0 && !st.current) beep()
    prevWaiting.current = n
  }, [st, sound])

  const act = async (path: string, ok?: string) => {
    if (busy) return
    setBusy(true)
    try {
      setSt(await api<DeskState>(`/api/desk/${path}`, { method: 'POST' }))
      if (ok) toast(ok)
    } catch (e) {
      toast((e as Error).message, 'error')
      void load()
    } finally {
      setBusy(false)
    }
  }
  const doTransfer = async (sectorId: number) => {
    setBusy(true)
    try {
      setSt(await api<DeskState>('/api/desk/transfer', { body: { sectorId } }))
      setTransfer(false)
      toast(t('desk.transferred'))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const chooseDesk = async (deskId: number | null) => {
    try {
      setSt(await api<DeskState>('/api/desk/desk', { body: { deskId } }))
      await refresh()
      toast(t('desk.deskUpdated'))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const absent = async () => {
    if (!st?.current) return
    if (await confirm({ title: t('desk.absentTitle'), message: t('desk.absentMsg', { code: st.current.code }), confirmLabel: t('desk.absentOk'), danger: true }))
      void act('absent', t('desk.markedAbsent'))
  }
  const exit = async () => {
    if (st?.current && !(await confirm({ title: t('desk.openTitle'), message: t('desk.openMsg', { code: st.current.code }), confirmLabel: t('desk.leaveAnyway'), danger: true }))) return
    await logout()
  }

  const cur = st?.current
  const next = st?.waiting[0]
  useHotkeys(
    {
      ' ': () => !cur && next && act('call-next'),
      F1: () => !cur && next && act('call-next'),
      r: () => cur?.status === 'called' && act('recall', t('desk.recalled')),
      i: () => cur?.status === 'called' && act('start'),
      f: () => cur && act('finish', t('desk.finished')),
      a: () => cur?.status === 'called' && void absent(),
      d: () => cur && st!.transferTargets.length > 0 && setTransfer(true),
      '?': () => setHelp(true),
    },
    !busy,
  )

  if (!st) return error ? <div className="p-6"><ErrorBox msg={error} retry={load} /></div> : <Spinner />
  const { sector, waiting, stats, thresholds } = st
  const fg = textOn(sector.color)
  const oldest = waiting.length ? Math.max(...waiting.map((w) => waitMin(w.createdAt, now))) : 0

  return (
    <div className="flex min-h-full flex-col bg-mesh">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 px-5 py-3 shadow-sm sm:px-8" style={{ background: `linear-gradient(120deg, ${sector.color}, color-mix(in srgb, ${sector.color} 70%, #0b1220))`, color: fg }}>
        <div className="min-w-0 flex-1">
          <div className="display truncate text-xl font-semibold">{sector.name}</div>
          <div className="flex items-center gap-2 truncate text-sm opacity-85">
            {user?.displayName}
            {!connected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-xs">
                <WifiOff size={12} /> {t('desk.offline')}
              </span>
            )}
          </div>
        </div>
        {st.desks.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="opacity-80">{t('desk.desk')}</span>
            <select
              value={st.user.deskId ?? ''}
              onChange={(e) => void chooseDesk(e.target.value ? Number(e.target.value) : null)}
              className="rounded-lg border border-current/25 bg-black/10 px-2 py-1.5 font-medium [&>option]:text-ink"
              aria-label="Elegir puesto"
            >
              <option value="">{st.user.desk ? `${st.user.desk} (${t('desk.manual')})` : t('desk.chooseDesk')}</option>
              {st.desks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          st.user.desk && <span className="rounded-lg bg-black/10 px-3 py-1.5 text-sm font-medium">{st.user.desk}</span>
        )}
        <div className="flex items-center">
          <button onClick={() => { setSound(!sound); savePref('celtto.desk.sound', !sound) }} className="rounded-md p-2 hover:bg-black/10" aria-label={sound ? 'Silenciar aviso de turno nuevo' : 'Activar aviso de turno nuevo'} title={sound ? 'Aviso sonoro activado' : 'Aviso sonoro desactivado'}>
            {sound ? <Bell size={17} /> : <BellOff size={17} />}
          </button>
          <button onClick={() => { setCompact(!compact); savePref('celtto.desk.compact', !compact) }} className="rounded-md p-2 hover:bg-black/10" aria-label={compact ? 'Vista normal' : 'Vista compacta'} title={compact ? 'Vista normal' : 'Vista compacta (monitores chicos)'}>
            {compact ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
          </button>
          <button onClick={() => setHelp(true)} className="hidden rounded-md p-2 hover:bg-black/10 sm:block" aria-label="Atajos de teclado" title="Atajos de teclado (?)">
            <Keyboard size={17} />
          </button>
          <LanguageSwitcher className="mx-1 hidden md:inline-flex" />
          <Link to="/cuenta" className="rounded-md p-2 hover:bg-black/10" aria-label={t('desk.account')} title={t('desk.account')}><UserCog size={17} /></Link>
          <ThemeToggle className="hover:bg-black/10" />
          <button onClick={exit} className="ml-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/10">
            <LogOut size={17} />
            {t('desk.logout')}
          </button>
        </div>
      </header>

      <main className={`mx-auto w-full max-w-6xl flex-1 ${compact ? 'space-y-3 p-3 sm:p-4' : 'space-y-5 p-5 sm:p-8'}`}>
        <dl className={`grid grid-cols-2 sm:grid-cols-4 ${compact ? 'gap-2' : 'gap-3'}`}>
          {(
            [
              [t('desk.waiting'), stats.waiting, null],
              [t('desk.doneToday'), stats.done, null],
              [t('desk.absent'), stats.absent, null],
              [t('desk.longest'), `${oldest} min`, waitLevel(oldest, thresholds.warn, thresholds.danger)],
            ] as const
          ).map(([l, v, lvl]) => (
            <Card key={l} className={compact ? 'px-3 py-2' : 'px-4 py-3'}>
              <dt className="text-sm text-muted">{l}</dt>
              <dd className={`num leading-tight ${compact ? 'text-2xl' : 'text-3xl'} ${lvl === 'danger' ? 'text-danger' : lvl === 'warn' ? 'text-warn' : ''}`}>{v}</dd>
            </Card>
          ))}
        </dl>

        <div className={`grid items-start lg:grid-cols-[1.25fr_1fr] ${compact ? 'gap-3' : 'gap-5'}`}>
          {cur ? (
            <div className="stub fade-up overflow-hidden rounded-2xl bg-surface shadow-lg ring-1 ring-line" style={{ ['--notch' as string]: '68%' }}>
              <div className={compact ? 'px-5 pb-6 pt-4' : 'px-6 pb-8 pt-6'} style={{ background: `linear-gradient(140deg, ${sector.color}, color-mix(in srgb, ${sector.color} 72%, #0b1220))`, color: fg }}>
                <div className="flex items-center justify-between text-sm opacity-90">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-current pulse-dot" />
                    {cur.status === 'called' ? t('desk.calledWaiting') : t('desk.serving')}
                    {cur.recallCount > 0 ? ` · ${cur.recallCount} ${t('desk.recalls')}` : ''}
                  </span>
                  <span className="num text-xl">{elapsed(cur.status === 'serving' ? cur.startedAt : cur.calledAt, now)}</span>
                </div>
                <div className={`num mt-2 leading-[0.9] ${compact ? 'text-7xl' : 'text-[clamp(5rem,14vw,9rem)]'}`}>{cur.code}</div>
                <div className="mt-2 text-lg opacity-90">{cur.buttonLabel} · {t('desk.waited', { n: waitMin(cur.createdAt, Date.parse(cur.calledAt ?? cur.createdAt)) })}</div>
              </div>
              {cur.patient ? (
                <div className="flex flex-wrap items-center gap-4 border-b border-line bg-surface px-6 py-4">
                  <Avatar name={cur.patient.name} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="display truncate text-xl font-semibold">{cur.patient.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                      <span className="inline-flex items-center gap-1 font-mono"><IdCard size={14} /> {cur.patient.documentType} {cur.patient.document}</span>
                      {cur.patient.phone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {cur.patient.phone}</span>}
                      {cur.patient.healthInsurance && <span className="inline-flex items-center gap-1"><HeartPulse size={13} /> {cur.patient.healthInsurance}{cur.patient.insuranceNumber ? ` · ${cur.patient.insuranceNumber}` : ''}</span>}
                      <span className="badge badge-brand">{cur.patient.visits <= 1 ? t('desk.firstVisit') : t('desk.visits', { n: cur.patient.visits })}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="soft" onClick={() => setPf({ phone: cur.patient!.phone ?? '', healthInsurance: cur.patient!.healthInsurance ?? '', insuranceNumber: cur.patient!.insuranceNumber ?? '', notes: cur.patient!.notes ?? '' })}>
                    <Pencil size={14} /> {t('desk.editPatient')}
                  </Button>
                  {cur.patient.notes && (
                    <div className="flex w-full items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn"><StickyNote size={15} className="mt-0.5 shrink-0" /> {cur.patient.notes}</div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 border-b border-line px-6 py-3 text-[13px] text-muted"><UserRound size={15} /> {t('desk.unidentified')}{cur.dni ? ` · DNI ${cur.dni}` : ''}</div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-dashed border-line px-5 py-4">
                {cur.status === 'called' ? (
                  <>
                    <Button size="lg" onClick={() => act('start')} disabled={busy}>
                      <Play size={18} />
                      {t('desk.start')}<Kbd>I</Kbd>
                    </Button>
                    <Button size="lg" variant="soft" onClick={() => act('recall', t('desk.recalled'))} disabled={busy}>
                      <BellRing size={18} />
                      {t('desk.recall')}<Kbd>R</Kbd>
                    </Button>
                    <Button size="lg" variant="soft" className="!text-danger" onClick={absent} disabled={busy}>
                      <UserX size={18} />
                      {t('desk.noShow')}<Kbd>A</Kbd>
                    </Button>
                  </>
                ) : (
                  <Button size="lg" variant="success" onClick={() => act('finish', t('desk.finished'))} disabled={busy}>
                    <Check size={18} />
                    {t('desk.finish')}<Kbd>F</Kbd>
                  </Button>
                )}
                <Button size="lg" variant="soft" onClick={() => setTransfer(true)} disabled={busy || st.transferTargets.length === 0}>
                  <ArrowRightLeft size={18} />
                  {t('desk.transfer')}<Kbd>D</Kbd>
                </Button>
              </div>
            </div>
          ) : (
            <Card className={`text-center ${compact ? 'px-5 py-6' : 'px-6 py-10'}`}>
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: `${sector.color}1f`, color: sector.color }}>
                <Megaphone size={26} />
              </div>
              <div className="display text-2xl font-semibold">{next ? t('desk.ready') : t('desk.empty')}</div>
              <p className="mx-auto mt-1 max-w-sm text-muted">
                {next ? (
                  t('desk.nextIs', { code: next.code, label: next.buttonLabel })
                ) : (
                  t('desk.emptyHint')
                )}
              </p>
              {!st.user.desk && st.desks.length > 0 && <p className="mt-3 text-sm font-medium text-warn">{t('desk.pickDeskHint')}</p>}
              <Button size="xl" className="mt-6 px-10" onClick={() => act('call-next')} disabled={busy || !next}>
                <Megaphone size={20} />
                {t('desk.callNext')}<Kbd>{t('desk.space')}</Kbd>
              </Button>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="display text-lg font-semibold">{t('desk.queue')}</h2>
              <span className="num text-2xl">{waiting.length}</span>
            </div>
            {waiting.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">{t('desk.queueEmpty')}</p>
            ) : (
              <ul className={`divide-y divide-line overflow-auto ${compact ? 'max-h-[22rem]' : 'max-h-[30rem]'}`}>
                {waiting.map((w, i) => {
                  const m = waitMin(w.createdAt, now)
                  const lvl = waitLevel(m, thresholds.warn, thresholds.danger)
                  return (
                    <li key={w.id} className={`flex items-center gap-3 px-5 ${compact ? 'py-2' : 'py-3'} ${i === 0 ? 'bg-brand-soft/40' : ''}`}>
                      <span className={`num w-20 ${compact ? 'text-xl' : 'text-2xl'}`}>{w.code}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{w.patientName ?? <span className="font-normal text-muted">{t('desk.unidentified')}</span>}</div>
                        <div className="truncate text-xs text-muted">{w.buttonLabel}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className={`badge ${LEVEL[lvl]}`} title="Tiempo de espera">{m} min</span>
                          {w.priorityName && (
                            <span className="badge" style={{ background: `${w.priorityColor ?? '#2563eb'}22`, color: w.priorityColor ?? '#2563eb' }}>
                              {w.priorityName}
                            </span>
                          )}
                          {i === 0 && <span className="badge badge-brand">{t('desk.nextBadge')}</span>}
                        </div>
                      </div>
                      <Button variant="soft" size="sm" onClick={() => act(`call/${w.id}`)} disabled={busy || !!cur}>
                        {t('desk.call')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
        <p className="hidden text-center text-xs text-muted sm:block">
          Atendidos hoy en la secretaría: {stats.done} · Espera promedio {fmtMin(stats.avgWaitMin)} · Atención promedio {fmtMin(stats.avgServiceMin)} · Tocá <Kbd>?</Kbd> para ver los atajos
        </p>
      </main>

      {transfer && (
        <Modal title={t('desk.transferTitle')} onClose={() => setTransfer(false)}>
          <p className="text-sm text-muted">{t('desk.transferHint', { code: cur?.code })}</p>
          <div className="grid gap-2">
            {st.transferTargets.map((t) => (
              <button key={t.id} onClick={() => doTransfer(t.id)} disabled={busy} className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-left font-medium hover:bg-paper">
                <span className="h-4 w-4 rounded-sm" style={{ background: t.color }} />
                {t.name}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {pf && (
        <Modal
          title={t('desk.patientData')}
          onClose={() => setPf(null)}
          footer={
            <>
              <Button variant="soft" onClick={() => setPf(null)}>{t('desk.cancel')}</Button>
              <Button
                onClick={async () => {
                  try {
                    setSt(await api<DeskState>('/api/desk/patient', { method: 'PUT', body: pf }))
                    setPf(null)
                    toast(t('desk.saved'))
                  } catch (e) {
                    toast((e as Error).message, 'error')
                  }
                }}
              >
                {t('desk.save')}
              </Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('desk.phone')}><input className={inputCls} value={pf.phone} onChange={(e) => setPf({ ...pf, phone: e.target.value })} inputMode="tel" autoFocus /></Field>
            <Field label={t('desk.insurance')}><input className={inputCls} value={pf.healthInsurance} onChange={(e) => setPf({ ...pf, healthInsurance: e.target.value })} /></Field>
            <Field label={t('desk.insuranceNumber')}><input className={inputCls} value={pf.insuranceNumber} onChange={(e) => setPf({ ...pf, insuranceNumber: e.target.value })} /></Field>
          </div>
          <Field label={t('desk.notes')} hint={t('desk.notesHint')}><textarea className={inputCls} rows={2} value={pf.notes} onChange={(e) => setPf({ ...pf, notes: e.target.value })} maxLength={500} /></Field>
        </Modal>
      )}
      {help && (
        <Modal title={t('desk.shortcuts')} onClose={() => setHelp(false)}>
          <ul className="space-y-2 text-sm">
            {[
              ['Espacio / F1', 'Llamar al siguiente'],
              ['R', 'Volver a llamar'],
              ['I', 'Iniciar atención'],
              ['F', 'Finalizar'],
              ['A', 'Marcar ausente'],
              ['D', 'Derivar a otra secretaría'],
              ['?', 'Ver esta ayuda'],
            ].map(([k, v]) => (
              <li key={k} className="flex items-center justify-between border-b border-line pb-2 last:border-0">
                <span>{v}</span>
                <Kbd className="!ml-0 !text-[12px]">{k}</Kbd>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  )
}
