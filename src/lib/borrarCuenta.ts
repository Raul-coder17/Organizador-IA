// Borrar cuenta: la única acción de la app que no se puede deshacer.
//
// El borrado real pasa entero en la Edge Function `delete-account` (ver
// supabase/functions/delete-account/index.ts): desde el cliente no se puede
// borrar un usuario de Auth, y aunque se pudiera, hacerlo a pedazos desde el
// navegador dejaría la cuenta a medio vaciar en cuanto se cortara la red.
//
// Acá vive lo que le toca al dispositivo, y el orden importa:
//   1) Primero el servidor. Si esa llamada falla, NO se toca nada local: la
//      cuenta sigue viva y el usuario puede reintentar sin haber perdido su
//      espejo local mientras tanto.
//   2) Recién con el `ok` del servidor se limpia el dispositivo, porque a esa
//      altura los datos locales son la copia de algo que ya no existe.
//
// El paso 2 es best-effort en cada una de sus partes y NUNCA revierte al 1: la
// cuenta ya no está, así que fallar limpiando no es motivo para decir que el
// borrado no ocurrió. Lo que sí hace es contarlo (ver `avisos`).

import { supabase } from './supabase'
import { wipeLocalDatabase } from './db'
import { unsubscribeLocalPush } from './push'
import { THEME_STORAGE_KEY } from './theme'

// La palabra que hay que tipear para habilitar el botón final. En mayúsculas y
// sin acentos: tiene que poder escribirse igual en cualquier teclado.
export const PALABRA_CONFIRMACION = 'ELIMINAR'

// ¿El texto tipeado habilita el borrado?
//
// Se recortan los espacios (pegar desde otro lado suele arrastrar uno) pero NO
// se ignoran las mayúsculas: escribir la palabra exacta es justo la fricción
// que hace que el gesto sea deliberado y no un "sí" reflejo. Función aparte y
// exportada para poder probarla sin montar la UI.
export function confirmacionValida(texto: string): boolean {
  return texto.trim() === PALABRA_CONFIRMACION
}

// Marca de una sola lectura para que el login pueda decir "listo, se borró".
// sessionStorage y no localStorage: el aviso vale para esta pestaña y este
// momento, no tiene por qué sobrevivir a cerrar el navegador. Además queda
// fuera de la limpieza de localStorage de acá abajo, que corre justo antes.
export const CUENTA_BORRADA_KEY = 'organizador:cuentaBorrada'

// Lee y consume el aviso: la segunda llamada devuelve false. Que la lectura lo
// borre evita que el mensaje reaparezca al recargar el login diez minutos
// después.
export function consumirAvisoCuentaBorrada(): boolean {
  try {
    if (sessionStorage.getItem(CUENTA_BORRADA_KEY) !== '1') return false
    sessionStorage.removeItem(CUENTA_BORRADA_KEY)
    return true
  } catch {
    return false
  }
}

// Borra del localStorage todo lo que la app haya guardado de esta cuenta: la
// caché de `ai_enabled` (`organizador:aiEnabled:<uid>`) y la sesión de
// supabase-js (`sb-<ref>-auth-token`). Se barre por prefijo en vez de listar
// claves: si mañana se agrega otra caché `organizador:*`, entra sola.
//
// La única excepción es el TEMA (`organizador:theme`). No es un dato de la
// cuenta —es claro u oscuro, no dice nada de nadie— y borrarlo haría que la
// pantalla cambiara de color justo en el segundo en que se confirma un borrado
// irreversible. Preferimos que lo último que vea el usuario sea la app que
// venía usando.
function limpiarStorageLocal(): void {
  try {
    const aBorrar = Object.keys(localStorage).filter(
      (k) => (k.startsWith('organizador:') || k.startsWith('sb-')) && k !== THEME_STORAGE_KEY,
    )
    for (const k of aBorrar) localStorage.removeItem(k)
  } catch {
    /* storage bloqueado: no hay nada que limpiar */
  }
}

// Saca el mensaje real que mandó la Edge Function. `functions.invoke` envuelve
// cualquier respuesta >= 400 en un error genérico ("non-2xx status code") y
// deja el cuerpo sin leer en `context`. Para el resto de la app alcanzaba con
// el genérico; acá no: el caso "la cuenta se borró pero quedaron datos" se
// distingue del "no se borró nada" SÓLO por ese texto, y es exactamente lo que
// el usuario necesita saber.
async function mensajeDeError(error: unknown): Promise<string> {
  const contexto = (error as { context?: unknown })?.context
  if (contexto instanceof Response) {
    try {
      const cuerpo = await contexto.clone().json()
      if (typeof cuerpo?.error === 'string') {
        const restos = Array.isArray(cuerpo.restos) ? cuerpo.restos.join(', ') : null
        return restos ? `${cuerpo.error} (${restos})` : cuerpo.error
      }
    } catch {
      /* el cuerpo no era JSON: caemos al mensaje genérico */
    }
  }
  const mensaje = (error as { message?: unknown })?.message
  return typeof mensaje === 'string' && mensaje
    ? mensaje
    : 'No se pudo borrar la cuenta. Probá de nuevo.'
}

export interface ResultadoBorrado {
  /** Avisos de la limpieza local. La cuenta ya se borró igual. */
  avisos: string[]
}

// Borra la cuenta de punta a punta. Tira si el servidor no pudo borrarla (en
// ese caso no se tocó nada, ni local ni remoto).
export async function borrarCuenta(): Promise<ResultadoBorrado> {
  const { error } = await supabase.functions.invoke('delete-account', {
    // Body vacío a propósito: la función IGNORA el body y saca el id del JWT.
    // Mandar el user_id sería sugerir que se puede elegir a quién borrar.
    body: {},
  })

  if (error) throw new Error(await mensajeDeError(error))

  // Desde acá la cuenta ya no existe. Nada de lo que sigue puede fallar de una
  // forma que justifique decir lo contrario.
  const avisos: string[] = []

  try {
    sessionStorage.setItem(CUENTA_BORRADA_KEY, '1')
  } catch {
    /* sin el aviso, el login igual aparece: es un mensaje, no el flujo */
  }

  // Cerrar la sesión ANTES de limpiar el dispositivo, y no al final. Al caer la
  // sesión, el layout privado se desmonta y con él el motor de sync y el
  // watcher de recordatorios: nadie queda leyendo ni escribiendo la base local
  // mientras se la vacía. Además el usuario ve el login de inmediato, en vez de
  // esperar mirando Ajustes a que termine una limpieza que ya no puede fallar
  // de forma interesante.
  //
  // `scope: 'local'` a propósito: el signOut normal le avisa al servidor, y el
  // servidor ya no tiene ni usuario ni sesión que revocar — sería un pedido
  // condenado a fallar. Esto sólo limpia la sesión del cliente y emite
  // SIGNED_OUT, que es lo que hace que ProtectedRoute vuelva al login.
  await supabase.auth.signOut({ scope: 'local' })

  await unsubscribeLocalPush()

  // Alcanza con que UNA de las dos haya salido para que no quede información:
  // vaciar los stores deja el archivo sin datos, y borrar la base se los lleva
  // junto con el archivo. Que quede la base vacía (porque otra pestaña la tenía
  // abierta y bloqueó el borrado) no es algo que el usuario tenga que resolver,
  // así que no se le dice. Sólo se avisa si fallaron las dos.
  const { vaciada, borrada } = await wipeLocalDatabase()
  if (!vaciada && !borrada) {
    avisos.push(
      'La cuenta se borró, pero no se pudieron borrar los datos guardados en este dispositivo. Borrá los datos del sitio desde la configuración del navegador.',
    )
  }

  // Último: se lleva la caché de `ai_enabled` y lo que haya dejado supabase-js
  // (el signOut de arriba ya borró su clave de sesión, pero puede quedar algo
  // más con el mismo prefijo).
  limpiarStorageLocal()

  return { avisos }
}
