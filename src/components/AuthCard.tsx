import type { ReactNode } from 'react'

// La tarjeta centrada de las pantallas de sesión (login/alta, recuperar
// contraseña, restablecerla). Vive en un componente y no copiada en cada
// página porque las tres son la MISMA pantalla con distinto contenido: si el
// chasis se duplicara, la de restablecer —que se ve una vez cada tanto y por
// eso nadie mira— sería la primera en quedar desalineada del login.
//
// No lleva toggle de tema: fuera del shell no hay barra donde ponerlo, y el
// script inline de index.html ya resuelve claro/oscuro por preferencia guardada
// o del sistema antes del primer pintado.
export function AuthCard({ subtitulo, children }: { subtitulo: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-card border border-line rounded-[2px] p-6">
        <h1 className="app-brand mb-1">Organizador Personal IA</h1>
        <p className="text-sm text-ink-soft mb-6">{subtitulo}</p>
        {children}
      </div>
    </div>
  )
}
