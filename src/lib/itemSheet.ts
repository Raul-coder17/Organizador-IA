// Puente para abrir el sheet de "+ Nuevo ítem" (PLAN_REDISEÑO.md ítem 11).
//
// El sheet vive montado en el AppShell (mismo patrón que el drawer del
// asistente), pero se dispara desde varios lados que están dentro del <Outlet>:
// el botón de la Biblioteca, la tarjeta "Nuevo" de Hoy y el "Editar" de cada
// ficha. En vez de que cada uno navegue con estado, el shell provee estas dos
// acciones por contexto y los consumidores las llaman directo.
//
// Va en su propio módulo (no en AppShell.tsx) para que lo puedan importar las
// páginas sin arrastrar el componente del shell y sin el warning de fast-refresh
// que da exportar un contexto al lado de un componente.
import { createContext, useContext } from 'react'
import type { Item } from '../types/database'

export interface ItemSheetApi {
  /** Abre el sheet en modo "nuevo": arranca en el menú de 3 opciones. */
  nuevo: () => void
  /** Abre el sheet en modo edición, con el formulario cargado para ese ítem. */
  editar: (item: Item) => void
}

// El default no-op deja que un consumidor fuera del provider no explote; en la
// app real siempre está el provider del AppShell.
export const ItemSheetContext = createContext<ItemSheetApi>({
  nuevo: () => {},
  editar: () => {},
})

export function useItemSheet(): ItemSheetApi {
  return useContext(ItemSheetContext)
}
