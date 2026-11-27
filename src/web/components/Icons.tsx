import {
  Accessibility, Baby, Briefcase, Calendar, CircleHelp, ClipboardList, CreditCard, FileText, FlaskConical,
  HeartPulse, Info, MessageCircle, Pill, Repeat, Stethoscope, Syringe, Ticket, UserRound, type LucideIcon,
} from 'lucide-react'

/** Íconos que el dueño puede elegir para cada botón del tótem. La clave es lo que se guarda en la base. */
export const BUTTON_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  ticket: { icon: Ticket, label: 'Turno' },
  repeat: { icon: Repeat, label: 'Continuar' },
  accessibility: { icon: Accessibility, label: 'Preferencial' },
  'file-text': { icon: FileText, label: 'Resultados' },
  'message-circle': { icon: MessageCircle, label: 'Consulta' },
  stethoscope: { icon: Stethoscope, label: 'Médico' },
  'heart-pulse': { icon: HeartPulse, label: 'Cardiología' },
  baby: { icon: Baby, label: 'Pediatría' },
  pill: { icon: Pill, label: 'Farmacia' },
  syringe: { icon: Syringe, label: 'Vacunas' },
  'flask-conical': { icon: FlaskConical, label: 'Laboratorio' },
  'clipboard-list': { icon: ClipboardList, label: 'Trámites' },
  'credit-card': { icon: CreditCard, label: 'Pagos' },
  calendar: { icon: Calendar, label: 'Turnos programados' },
  'user-round': { icon: UserRound, label: 'Persona' },
  briefcase: { icon: Briefcase, label: 'Empresas' },
  info: { icon: Info, label: 'Informes' },
  'circle-help': { icon: CircleHelp, label: 'Ayuda' },
}

export function ButtonIcon({ name, size = 28, className = '' }: { name: string | null | undefined; size?: number; className?: string }) {
  const Ico = (name && BUTTON_ICONS[name]?.icon) || Ticket
  return <Ico size={size} className={className} strokeWidth={1.75} aria-hidden />
}
