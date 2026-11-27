import { useState } from 'react'

/**
 * Logo de la institución (subido desde Configuración). Si no hay, muestra el isotipo de CELTTO.
 * `version` cambia cuando se sube un logo nuevo, para no quedarse con el cacheado.
 */
export function Logo({ className = 'h-10 w-10', version, rounded = 'rounded-xl' }: { className?: string; version?: string | null; rounded?: string }) {
  const [failed, setFailed] = useState(false)
  if (!failed && version !== null) {
    return (
      <img
        src={`/api/public/logo${version ? `?v=${encodeURIComponent(version)}` : ''}`}
        alt="Logo"
        className={`${className} ${rounded} shrink-0 object-contain`}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className={`${className} ${rounded} grid shrink-0 place-items-center bg-teal-600 text-white`} aria-hidden>
      <svg viewBox="0 0 32 32" className="h-3/5 w-3/5" fill="currentColor">
        <path d="M7 9h18v4a2.5 2.5 0 0 0 0 5v4H7v-4a2.5 2.5 0 0 0 0-5z" />
      </svg>
    </span>
  )
}
