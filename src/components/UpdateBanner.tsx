import { useRegisterSW } from 'virtual:pwa-register/react'

// Aviso de "hay una versión nueva" (PLAN_ORGANIZADOR.md, service worker).
//
// Con registerType 'prompt' (vite.config.ts) el SW nuevo instala y se queda
// esperando; nunca se activa solo. `useRegisterSW` nos avisa de eso vía
// `needRefresh`, y `updateServiceWorker(true)` es quien manda el postMessage
// SKIP_WAITING que sw.ts escucha y, al terminar 'activate', recarga la
// página — sin que el usuario tenga que cerrar la app.
//
// "Ahora no" no rechaza el update, solo oculta el aviso: el SW nuevo sigue
// esperando y basta recargar (o cerrar y volver a abrir) para que se aplique.
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__texto">Hay una versión nueva de Organizador.</span>
      <div className="update-banner__acciones">
        <button
          type="button"
          className="update-banner__ahora-no"
          onClick={() => setNeedRefresh(false)}
        >
          Ahora no
        </button>
        <button
          type="button"
          className="update-banner__btn"
          onClick={() => updateServiceWorker(true)}
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
