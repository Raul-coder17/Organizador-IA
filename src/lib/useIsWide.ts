import { useEffect, useState } from 'react'

// Breakpoint único del chasis (PLAN_REDISEÑO.md §2.1): a partir de 900px la app
// usa sidebar; abajo, barra superior + tab bar.
//
// Se resuelve en JS y no sólo con media queries porque el shell no cambia de
// estilo sino de *estructura*: en angosto se montan nodos que en ancho no
// existen (tab bar, FAB) y viceversa. Dibujar los dos y esconder uno con CSS
// duplicaría el buscador y los links en el árbol de accesibilidad.
//
// El mismo número vive también en index.css para el padding del contenido, que
// sí es puro estilo.
export const SHELL_BREAKPOINT = 900

function medir(): boolean {
  return window.innerWidth >= SHELL_BREAKPOINT
}

export function useIsWide(): boolean {
  const [wide, setWide] = useState(medir)

  useEffect(() => {
    const alRedimensionar = () => setWide(medir())
    // Una medición al montar: entre el primer render y este efecto la ventana
    // pudo cambiar (rotar el teléfono durante la carga, abrir devtools).
    alRedimensionar()
    window.addEventListener('resize', alRedimensionar)
    return () => window.removeEventListener('resize', alRedimensionar)
  }, [])

  return wide
}
