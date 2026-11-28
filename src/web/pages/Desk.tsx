import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRightLeft, Bell, BellOff, BellRing, Check, CheckCircle2, ChevronDown, Coffee, HeartPulse, IdCard, Keyboard, LogOut, Megaphone,
  Moon, Pencil, Phone, Play, Search, StickyNote, Sun, UserCog, UserRound, UserX, WifiOff, Clock, Users, Timer, Sparkles,
} from 'lucide-react'
import { useAuth } from '../auth'
import { api, type Stats } from '../lib/api'
import { elapsed, fmtMin, hhmm, textOn, waitLevel, waitMin } from '../lib/format'
import { useDebounced, useLive, useNow } from '../lib/live'
import { Avatar, Button, ErrorBox, Field, Kbd, Modal, Spinner, inputCls, useConfirm, useHotkeys, useTheme, useToast } from '../ui'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

interface Patient { id: number; name: string; document: string; documentType: string; visits: number; phone: string | null; notes: string | null; healthInsurance: string | null; insuranceNumber: string | null }
interface Current { id: number; code: string; status: 'called' | 'serving'; createdAt: string; calledAt: string | null; startedAt: string | null; recallCount: number; buttonLabel: string; dni: string | null; patient: Patient | null }
interface Waiting { id: number; code: string; priority: number; priorityName: string | null; priorityColor: string | null; createdAt: string; buttonLabel: string; patientName: string | null }
interface DeskState {
  mine: { done: number; absent: number; avgServiceMin: number | null; recent: { id: number; code: string; status: string; finishedAt: string | null; patientName: string | null }[] }
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
const LEVEL = { ok: 'text-ok bg-ok-soft', warn: 'text-warn bg-warn-soft', danger: 'text-danger bg-danger-soft' } as const

/** Anillo de tiempo alrededor del cronómetro (una vuelta = umbral de alerta). */
function TimerRing({ since, now, warnMin, color }: { since: string | null; now: number; warnMin: number; color: string }) {
  const secs = since ? Math.max(0, (now - Date.parse(since)) / 1000) : 0
  const k = Math.min(1, secs / (warnMin * 60))
  const r = 44
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid h-28 w-28 shrink-0 place-items-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="7" />
        <motion.circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} animate={{ strokeDashoffset: c * (1 - k) }} transition={{ duration: 0.8 }} />
      </svg>
      <div className="text-center">
        <div className="num text-2xl leading-none">{elapsed(since, now)}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider opacity-60">min</div>
      </div>
    </div>
  )
}

export default function Desk() {
  const { t } = useTranslation()
  const { user, logout, refresh } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const { dark, toggle } = useTheme()
  const now = useNow()
  const [st, setSt] = useState<DeskState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [transfer, setTransfer] = useState(false)
  const [help, setHelp] = useState(false)
  const [menu, setMenu] = useState(false)
  const [q, setQ] = useState('')
  const [sound, setSound] = useState(() => pref('celtto.desk.sound', true))
  const [paused, setPaused] = useState(() => pref('celtto.desk.paused', false))
  const [pf, setPf] = useState<{ phone: string; healthInsurance: string; insuranceNumber: string; notes: string } | null>(null)
  const [justFinished, setJustFinished] = useState<string | null>(null)
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
  useEffect(() => {
    if (!st) return
    const n = st.waiting.length
    if (sound && !paused && prevWaiting.current === 0 && n > 0 && !st.current) beep()
    prevWaiting.current = n
  }, [st, sound, paused])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const act = async (path: string, ok?: string) => {
    if (busy) return
    setBusy(true)
    try {
      const code = st?.current?.code
      setSt(await api<DeskState>(`/api/desk/${path}`, { method: 'POST' }))
      if (path === 'finish' && code) {
        setJustFinished(code)
        setTimeout(() => setJustFinished(null), 2200)
      } else if (ok) toast(ok)
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
    if (await confirm({ title: t('desk.absentTitle'), message: t('desk.absentMsg', { code: st.current.code }), confirmLabel: t('desk.absentOk'), danger: true })) void act('absent', t('desk.markedAbsent'))
  }
  const exit = async () => {
    if (st?.current && !(await confirm({ title: t('desk.openTitle'), message: t('desk.openMsg', { code: st.current.code }), confirmLabel: t('desk.leaveAnyway'), danger: true }))) return
    await logout()
  }
  const togglePause = () => {
    setPaused((v) => {
      savePref('celtto.desk.paused', !v)
      return !v
    })
  }

  const cur = st?.current
  const next = st?.waiting[0]
  useHotkeys(
    {
      ' ': () => !cur && next && !paused && act('call-next'),
      F1: () => !cur && next && !paused && act('call-next'),
      r: () => cur?.status === 'called' && act('recall', t('desk.recalled')),
      i: () => cur?.status === 'called' && act('start'),
      f: () => cur && act('finish'),
      a: () => cur?.status === 'called' && void absent(),
      d: () => cur && st!.transferTargets.length > 0 && setTransfer(true),
      p: () => !cur && togglePause(),
      '/': () => document.getElementById('queue-search')?.focus(),
      '?': () => setHelp(true),
    },
    !busy,
  )

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (st?.waiting ?? []).filter((w) => !term || w.code.toLowerCase().includes(term) || (w.patientName ?? '').toLowerCase().includes(term) || w.buttonLabel.toLowerCase().includes(term))
  }, [st?.waiting, q])

  if (!st) return error ? <div className="p-6"><ErrorBox msg={error} retry={load} /></div> : <Spinner />
  const { sector, waiting, thresholds, mine } = st
  const fg = textOn(sector.color)
  const oldest = waiting.length ? Math.max(...waiting.map((w) => waitMin(w.createdAt, now))) : 0
  const hour = new Date(now).getHours()
  const hello = hour < 12 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'
  const step = !cur ? 0 : cur.status === 'called' ? 1 : 2

  return (
    <div className="flex min-h-full flex-col bg-mesh">
      {/* Barra superior */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
          <span className="flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[14px] font-semibold" style={{ background: `${sector.color}1a`, color: sector.color }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: sector.color }} /> {sector.name}
          </span>
          {st.desks.length > 0 ? (
            <select value={st.user.deskId ?? ''} onChange={(e) => void chooseDesk(e.target.value ? Number(e.target.value) : null)} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13.5px] font-medium" aria-label={t('desk.chooseDesk')}>
              <option value="">{st.user.desk ? `${st.user.desk} (${t('desk.manual')})` : t('desk.chooseDesk')}</option>
              {st.desks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          ) : (
            st.user.desk && <span className="rounded-lg border border-line px-2.5 py-1.5 text-[13.5px] font-medium">{st.user.desk}</span>
          )}
          <button onClick={() => !cur && togglePause()} disabled={!!cur} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${paused ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'} disabled:opacity-60`} title="Pausa (P)">
            {paused ? <Coffee size={14} /> : <span className="pulse-dot h-2 w-2 rounded-full bg-current" />}
            {paused ? 'En pausa' : 'Disponible'}
          </button>
          {!connected && <span className="flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-[12px] text-danger"><WifiOff size={13} /> {t('desk.offline')}</span>}

          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => { setSound(!sound); savePref('celtto.desk.sound', !sound) }} className="rounded-lg p-2 text-muted hover:bg-paper hover:text-ink" title={sound ? 'Aviso sonoro activado' : 'Aviso sonoro desactivado'} aria-label="Aviso sonoro">
              {sound ? <Bell size={17} /> : <BellOff size={17} />}
            </button>
            <button onClick={() => setHelp(true)} className="hidden rounded-lg p-2 text-muted hover:bg-paper hover:text-ink sm:block" title="Atajos de teclado (?)" aria-label={t('desk.shortcuts')}>
              <Keyboard size={17} />
            </button>
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-paper" aria-label="Menú de usuario">
                <Avatar name={user?.displayName ?? '?'} size={30} />
                <span className="hidden max-w-32 truncate text-[13px] font-medium md:block">{user?.displayName}</span>
                <ChevronDown size={14} className="text-muted" />
              </button>
              <AnimatePresence>
                {menu && (
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }} className="surface-elevated absolute right-0 top-11 z-50 w-56 p-1.5">
                    <Link to="/cuenta" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-paper"><UserCog size={15} className="text-muted" /> {t('desk.account')}</Link>
                    <button onClick={toggle} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] hover:bg-paper">{dark ? <Sun size={15} className="text-muted" /> : <Moon size={15} className="text-muted" />} {dark ? 'Tema claro' : 'Tema oscuro'}</button>
                    <div className="px-3 py-1.5"><LanguageSwitcher className="text-muted" /></div>
                    <div className="my-1 h-px bg-line" />
                    <button onClick={exit} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-danger hover:bg-danger-soft"><LogOut size={15} /> {t('desk.logout')}</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 sm:px-6">
        {/* Saludo y resumen personal */}
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="display text-[1.75rem] font-semibold tracking-tight">{hello}, {user?.displayName.split(' ')[0]}</h1>
            <p className="mt-0.5 text-[14px] text-muted">
              {mine.done === 0 ? 'Todavía no atendiste a nadie hoy. ¡Arranquemos!' : <>Hoy atendiste a <b className="text-ink">{mine.done}</b> {mine.done === 1 ? 'persona' : 'personas'}{mine.avgServiceMin != null ? <> · {fmtMin(mine.avgServiceMin)} en promedio</> : null}</>}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { icon: Users, label: t('desk.waiting'), value: String(waiting.length), tone: '' },
              { icon: Clock, label: t('desk.longest'), value: `${oldest} min`, tone: waitLevel(oldest, thresholds.warn, thresholds.danger) },
              { icon: CheckCircle2, label: 'Mis atendidos', value: String(mine.done), tone: '' },
            ].map((k) => (
              <div key={k.label} className="surface min-w-[7.5rem] px-3.5 py-2.5">
                <div className="flex items-center gap-1.5 text-[11.5px] text-muted"><k.icon size={13} /> {k.label}</div>
                <div className={`num mt-0.5 text-2xl ${k.tone === 'danger' ? 'text-danger' : k.tone === 'warn' ? 'text-warn' : ''}`}>{k.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            {/* Pasos de la atención */}
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              {['Llamar', 'Recibir al paciente', 'Atender y finalizar'].map((l, i) => (
                <div key={l} className="flex flex-1 items-center gap-2">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] transition ${i < step ? 'bg-ok text-white' : i === step ? '' : 'bg-line text-muted'}`} style={i === step ? { background: sector.color, color: fg } : undefined}>
                    {i < step ? <Check size={13} /> : i + 1}
                  </span>
                  <span className={`truncate ${i === step ? 'text-ink' : 'text-muted'}`}>{l}</span>
                  {i < 2 && <span className={`h-px flex-1 ${i < step ? 'bg-ok' : 'bg-line'}`} />}
                </div>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {cur ? (
                <motion.div key={`cur-${cur.id}`} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ type: 'spring', stiffness: 220, damping: 24 }} className="overflow-hidden rounded-3xl bg-surface shadow-xl ring-1 ring-line">
                  <div className="relative overflow-hidden px-6 pb-6 pt-5 sm:px-8" style={{ background: `linear-gradient(135deg, ${sector.color}, color-mix(in srgb, ${sector.color} 68%, #0b1220))`, color: fg }}>
                    <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
                    <div className="relative flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.16em] opacity-90">
                          {cur.status === 'called' ? <><BellRing size={14} className="pulse-dot" /> {t('desk.calledWaiting')}</> : <><Play size={14} /> {t('desk.serving')}</>}
                        </div>
                        <div className="num mt-1 text-[clamp(4.5rem,11vw,7.5rem)] leading-[0.9]">{cur.code}</div>
                        <div className="mt-2 text-[15px] opacity-90">
                          {cur.buttonLabel} · {t('desk.waited', { n: waitMin(cur.createdAt, Date.parse(cur.calledAt ?? cur.createdAt)) })}
                          {cur.recallCount > 0 ? ` · ${cur.recallCount} ${t('desk.recalls')}` : ''}
                        </div>
                      </div>
                      <TimerRing since={cur.status === 'serving' ? cur.startedAt : cur.calledAt} now={now} warnMin={cur.status === 'serving' ? 15 : 3} color={fg === '#ffffff' ? '#ffffff' : '#0b1220'} />
                    </div>
                  </div>

                  {cur.patient ? (
                    <div className="flex flex-wrap items-center gap-4 border-b border-line px-6 py-4 sm:px-8">
                      <Avatar name={cur.patient.name} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="display truncate text-xl font-semibold">{cur.patient.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                          <span className="inline-flex items-center gap-1 font-mono"><IdCard size={14} /> {cur.patient.documentType} {cur.patient.document}</span>
                          {cur.patient.phone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {cur.patient.phone}</span>}
                          {cur.patient.healthInsurance && <span className="inline-flex items-center gap-1"><HeartPulse size={13} /> {cur.patient.healthInsurance}{cur.patient.insuranceNumber ? ` · ${cur.patient.insuranceNumber}` : ''}</span>}
                          <span className={`badge ${cur.patient.visits <= 1 ? 'badge-ok' : 'badge-brand'}`}>{cur.patient.visits <= 1 ? <><Sparkles size={11} /> {t('desk.firstVisit')}</> : t('desk.visits', { n: cur.patient.visits })}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="soft" onClick={() => setPf({ phone: cur.patient!.phone ?? '', healthInsurance: cur.patient!.healthInsurance ?? '', insuranceNumber: cur.patient!.insuranceNumber ?? '', notes: cur.patient!.notes ?? '' })}>
                        <Pencil size={14} /> {t('desk.editPatient')}
                      </Button>
                      {cur.patient.notes && <div className="flex w-full items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn"><StickyNote size={15} className="mt-0.5 shrink-0" /> {cur.patient.notes}</div>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 border-b border-line px-6 py-3 text-[13px] text-muted sm:px-8"><UserRound size={15} /> {t('desk.unidentified')}</div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 px-6 py-5 sm:px-8">
                    {cur.status === 'called' ? (
                      <>
                        <Button size="xl" className="min-w-[14rem] flex-1 sm:flex-none" onClick={() => act('start')} disabled={busy}><Play size={20} /> {t('desk.start')}<Kbd>I</Kbd></Button>
                        <Button size="lg" variant="soft" onClick={() => act('recall', t('desk.recalled'))} disabled={busy}><BellRing size={17} /> {t('desk.recall')}<Kbd>R</Kbd></Button>
                        <Button size="lg" variant="soft" className="!text-danger" onClick={absent} disabled={busy}><UserX size={17} /> {t('desk.noShow')}<Kbd>A</Kbd></Button>
                      </>
                    ) : (
                      <Button size="xl" variant="success" className="min-w-[14rem] flex-1 sm:flex-none" onClick={() => act('finish')} disabled={busy}><Check size={20} /> {t('desk.finish')}<Kbd>F</Kbd></Button>
                    )}
                    <Button size="lg" variant="ghost" className="ml-auto" onClick={() => setTransfer(true)} disabled={busy || st.transferTargets.length === 0}><ArrowRightLeft size={17} /> {t('desk.transfer')}<Kbd>D</Kbd></Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="idle" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="relative overflow-hidden rounded-3xl bg-surface p-8 text-center shadow-xl ring-1 ring-line sm:p-10">
                  <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-56 w-56 rounded-full blur-3xl" style={{ background: `${sector.color}33` }} />
                  <AnimatePresence>
                    {justFinished && (
                      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-10 grid place-items-center bg-surface/95">
                        <div>
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-ok text-white"><Check size={32} /></motion.span>
                          <div className="display mt-3 text-xl font-semibold">¡Listo! {justFinished} atendido</div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {paused ? (
                    <div className="relative">
                      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-warn-soft text-warn"><Coffee size={30} /></span>
                      <div className="display mt-4 text-2xl font-semibold">Estás en pausa</div>
                      <p className="mx-auto mt-1 max-w-sm text-muted">Mientras estés en pausa no vas a llamar turnos. Volvé cuando estés lista.</p>
                      <Button size="xl" className="mt-6 px-10" onClick={togglePause}><Play size={20} /> Volver a atender<Kbd>P</Kbd></Button>
                    </div>
                  ) : next ? (
                    <div className="relative">
                      <div className="text-[12.5px] font-semibold uppercase tracking-[0.18em] text-muted">Siguiente en la fila</div>
                      <motion.div key={next.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center justify-center gap-4">
                        <span className="num text-6xl" style={{ color: sector.color }}>{next.code}</span>
                        <div className="text-left">
                          <div className="font-semibold">{next.patientName ?? t('desk.unidentified')}</div>
                          <div className="text-[13px] text-muted">{next.buttonLabel} · espera {waitMin(next.createdAt, now)} min</div>
                        </div>
                      </motion.div>
                      {!st.user.desk && st.desks.length > 0 && <p className="mt-3 text-sm font-medium text-warn">{t('desk.pickDeskHint')}</p>}
                      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="inline-block">
                        <button onClick={() => act('call-next')} disabled={busy} className="group relative mt-7 inline-flex h-16 items-center gap-3 overflow-hidden rounded-2xl px-10 text-lg font-semibold shadow-xl transition disabled:opacity-50" style={{ background: sector.color, color: fg, boxShadow: `0 18px 40px -16px ${sector.color}` }}>
                          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                          <Megaphone size={22} /> {t('desk.callNext')} <Kbd>{t('desk.space')}</Kbd>
                        </button>
                      </motion.div>
                      <div className="mt-4 text-[12.5px] text-muted">o tocá “{t('desk.call')}” en cualquier turno de la lista</div>
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-ok-soft text-ok"><CheckCircle2 size={30} /></span>
                      <div className="display mt-4 text-2xl font-semibold">{t('desk.empty')}</div>
                      <p className="mx-auto mt-1 max-w-sm text-muted">{t('desk.emptyHint')}</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mis últimas atenciones */}
            <div className="surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Tus últimas atenciones</h2>
                <span className="text-[12.5px] text-muted">{mine.done} atendidos · {mine.absent} ausentes</span>
              </div>
              {mine.recent.length === 0 ? (
                <p className="text-[13.5px] text-muted">Acá vas a ver las personas que atendiste hoy.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {mine.recent.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 rounded-xl bg-paper px-3 py-2">
                      <span className={`grid h-8 w-8 place-items-center rounded-lg ${r.status === 'done' ? 'bg-ok-soft text-ok' : 'bg-line text-muted'}`}>{r.status === 'done' ? <Check size={15} /> : <UserX size={15} />}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{r.patientName ?? t('desk.unidentified')}</div>
                        <div className="text-[12px] text-muted"><span className="num">{r.code}</span> · {hhmm(r.finishedAt)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Cola */}
          <div className="surface overflow-hidden lg:sticky lg:top-20">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <h2 className="display text-lg font-semibold">{t('desk.queue')}</h2>
              <span className="num rounded-lg bg-paper px-2.5 py-0.5 text-xl">{waiting.length}</span>
            </div>
            {waiting.length > 3 && (
              <div className="border-b border-line px-4 py-2.5">
                <div className="relative">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input id="queue-search" className={`${inputCls} !py-2 pl-9`} placeholder="Buscar por nombre o código  ( / )" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>
            )}
            {waiting.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Timer size={26} className="mx-auto text-muted/60" />
                <p className="mt-2 text-sm text-muted">{t('desk.queueEmpty')}</p>
              </div>
            ) : (
              <ul className="max-h-[calc(100vh-16rem)] divide-y divide-line overflow-auto scrollbar-thin">
                <AnimatePresence initial={false}>
                  {filtered.map((w, i) => {
                    const m = waitMin(w.createdAt, now)
                    const lvl = waitLevel(m, thresholds.warn, thresholds.danger)
                    const first = w.id === waiting[0]?.id
                    return (
                      <motion.li key={w.id} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className={`group flex items-center gap-3 px-4 py-3 ${first ? 'bg-brand-soft/40' : 'hover:bg-paper/60'}`}>
                        <span className="w-5 text-center text-[12px] text-muted">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="num text-xl">{w.code}</span>
                            {first && <span className="badge badge-brand">{t('desk.nextBadge')}</span>}
                            {w.priorityName && <span className="badge" style={{ background: `${w.priorityColor ?? '#2563eb'}22`, color: w.priorityColor ?? '#2563eb' }}>{w.priorityName}</span>}
                          </div>
                          <div className="truncate text-[13px]">{w.patientName ?? <span className="text-muted">{t('desk.unidentified')}</span>}<span className="text-muted"> · {w.buttonLabel}</span></div>
                        </div>
                        <span className={`badge ${LEVEL[lvl]}`} title="Tiempo de espera">{m} min</span>
                        <Button variant="soft" size="sm" className="opacity-80 group-hover:opacity-100" onClick={() => act(`call/${w.id}`)} disabled={busy || !!cur || paused}>{t('desk.call')}</Button>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
                {filtered.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Ningún turno coincide con “{q}”.</li>}
              </ul>
            )}
          </div>
        </div>
      </main>

      {transfer && (
        <Modal title={t('desk.transferTitle')} onClose={() => setTransfer(false)}>
          <p className="text-sm text-muted">{t('desk.transferHint', { code: cur?.code })}</p>
          <div className="grid gap-2">
            {st.transferTargets.map((x) => (
              <button key={x.id} onClick={() => doTransfer(x.id)} disabled={busy} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-left font-medium transition hover:border-line-strong hover:bg-paper">
                <span className="h-4 w-4 rounded" style={{ background: x.color }} />
                {x.name}
                <ArrowRightLeft size={15} className="ml-auto text-muted" />
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
              ['P', 'Pausa / volver a atender'],
              ['/', 'Buscar en la cola'],
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
