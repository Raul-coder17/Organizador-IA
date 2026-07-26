// Reconstrucción del historial de la conversación en el formato `contents` que
// espera Gemini. Lógica pura (sin I/O ni Deno.serve) para poder testearla con
// `deno test` sin red ni Gemini real.
//
// EL PROBLEMA QUE RESUELVE
//
// Antes, cada mensaje del chat se mandaba como texto plano: el turno en que el
// modelo propuso crear un item viajaba como la frase que acompañó la propuesta
// ("Preparé la creación de un item…"), y lo que pasó DESPUÉS —que el usuario
// confirmara, o que la cancelara— no viajaba en absoluto. Con eso, en el turno
// siguiente Gemini no tenía forma de saber que su propuesta ya se resolvió, y
// podía volver a proponer algo ya creado, o insistir con algo ya rechazado.
//
// Ahora ese turno se reconstruye como lo que realmente fue: un `functionCall`
// con la tool y los args que el modelo emitió, seguido de un `functionResponse`
// con el desenlace real. Es el mismo par que el modelo ya vio dentro de la
// vuelta en que propuso, así que no es un formato nuevo para él — es el que la
// API define para "llamaste a esto y esto pasó".
//
// ALTERNANCIA DE ROLES
//
// Dos turnos "model" seguidos —lo que pasaba cuando confirmar agregaba un
// segundo mensaje de asistente al chat— se fusionan acá concatenando sus parts.
//
// Lo que NO se fusiona es el turno del functionResponse con el mensaje siguiente
// del usuario, aunque los dos sean "user". Se intentó y Gemini devolvió 400: un
// content con functionResponse tiene que llevar sólo functionResponse. Quedan
// entonces dos turnos "user" consecutivos (el resultado de la tool y lo que el
// usuario escribió después), que es la forma correcta: entre uno y otro no hay
// ningún turno del modelo porque nuestras propuestas cortan el loop y vuelven al
// cliente a esperar la confirmación, en vez de seguir la vuelta con Gemini.

import { PROPOSE_TOOLS } from './actions.ts'

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

export interface GeminiContent {
  role: string
  parts?: GeminiPart[]
}

// Desenlace de una acción propuesta, tal como lo informa el cliente.
//
// 'sin_responder' no es un estado que el usuario elija: es lo que queda cuando
// manda otro mensaje sin tocar la tarjeta. Vale la pena distinguirlo de
// 'cancelada' — "no me contestó" y "me dijo que no" son cosas distintas para
// decidir si conviene volver a ofrecer lo mismo.
export type EstadoAccionHistorial = 'aplicada' | 'cancelada' | 'error' | 'sin_responder'

export interface AccionHistorial {
  // Nombre de la tool y args tal cual los emitió Gemini cuando propuso.
  tool?: string
  args?: Record<string, unknown>
  estado?: string
  // Id real del item afectado, cuando la acción se aplicó.
  item_id?: string
  error?: string
}

export interface MensajeHistorial {
  role?: string
  text?: string
  acciones?: AccionHistorial[]
  // Mensajes que existen sólo para que el usuario vea qué pasó en el chat
  // ("Listo, creé el item."). No van al historial: lo que ese mensaje dice ya
  // está, con más precisión, en el functionResponse de la acción.
  solo_ui?: boolean
}

function esEstado(v: unknown): EstadoAccionHistorial | null {
  return v === 'aplicada' || v === 'cancelada' || v === 'error' || v === 'sin_responder' ? v : null
}

// El cuerpo del functionResponse: qué pasó con la acción, en términos que el
// modelo pueda usar para decidir. Va con una `nota` en español además de los
// campos estructurados porque es texto que el modelo lee directo, y "el usuario
// canceló, no vuelvas a proponerlo salvo que lo pida" es más difícil de
// malinterpretar que un booleano suelto.
export function respuestaDeAccion(accion: AccionHistorial): Record<string, unknown> {
  const estado = esEstado(accion.estado)

  if (estado === 'aplicada') {
    return {
      resultado: 'aplicada',
      confirmada_por_usuario: true,
      ...(accion.item_id ? { item_id: accion.item_id } : {}),
      nota: 'El usuario confirmó esta acción y ya se aplicó. No la vuelvas a proponer.',
    }
  }
  if (estado === 'cancelada') {
    return {
      resultado: 'cancelada',
      confirmada_por_usuario: false,
      nota: 'El usuario RECHAZÓ esta acción: no se aplicó y el cambio no existe. No la vuelvas a proponer salvo que el usuario la pida de nuevo explícitamente.',
    }
  }
  if (estado === 'error') {
    return {
      resultado: 'error',
      confirmada_por_usuario: true,
      error: accion.error ?? 'No se pudo aplicar el cambio.',
      nota: 'El usuario confirmó pero la acción falló, así que el cambio NO existe. Podés volver a proponerla si sigue teniendo sentido.',
    }
  }
  // 'sin_responder' y cualquier estado que no reconozcamos: lo conservador es
  // decir que no se aplicó, nunca que sí.
  return {
    resultado: 'sin_responder',
    confirmada_por_usuario: false,
    nota: 'El usuario no confirmó ni canceló esta acción, y siguió la conversación. El cambio NO se aplicó.',
  }
}

// Sólo se reinyecta como functionCall lo que tenga una tool declarada. Una
// acción sin `tool` (cliente viejo, todavía con la app cacheada) o con un nombre
// que no declaramos se ignora, y el turno cae de vuelta al texto plano de antes.
function callDeAccion(accion: AccionHistorial): { name: string; args: Record<string, unknown> } | null {
  if (typeof accion.tool !== 'string' || !PROPOSE_TOOLS.has(accion.tool)) return null
  return { name: accion.tool, args: accion.args ?? {} }
}

interface Turno {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/**
 * Arma el `contents` de Gemini a partir del historial del chat.
 *
 * Tolera de entrada lo mismo que antes (`{ role, text }` sin acciones): un
 * cliente viejo con la PWA cacheada sigue funcionando exactamente como funcionaba,
 * sólo que sin el beneficio del par functionCall/functionResponse.
 */
export function buildContents(messages: MensajeHistorial[]): GeminiContent[] {
  const turnos: Turno[] = []

  for (const m of messages) {
    if (m.solo_ui) continue

    const texto = typeof m.text === 'string' ? m.text.trim() : ''
    const esAsistente = m.role === 'assistant' || m.role === 'model'

    if (!esAsistente) {
      if (texto) turnos.push({ role: 'user', parts: [{ text: texto }] })
      continue
    }

    const acciones = Array.isArray(m.acciones) ? m.acciones : []
    const conCall = acciones
      .map((a) => ({ accion: a, call: callDeAccion(a) }))
      .filter((x): x is { accion: AccionHistorial; call: { name: string; args: Record<string, unknown> } } =>
        x.call !== null,
      )

    if (conCall.length === 0) {
      if (texto) turnos.push({ role: 'model', parts: [{ text: texto }] })
      continue
    }

    // El turno del modelo tal como fue: su texto (si lo hubo) y las calls que
    // emitió, en el mismo orden.
    const modelParts: GeminiPart[] = texto ? [{ text: texto }] : []
    for (const { call } of conCall) {
      modelParts.push({ functionCall: { name: call.name, args: call.args } })
    }
    turnos.push({ role: 'model', parts: modelParts })

    // Y la vuelta: un functionResponse por cada call, con el desenlace real.
    // Va como 'user' porque el resultado de una tool lo aporta el lado del
    // cliente, igual que hace el loop cuando ejecuta las tools de lectura.
    turnos.push({
      role: 'user',
      parts: conCall.map(({ accion, call }) => ({
        functionResponse: { name: call.name, response: respuestaDeAccion(accion) },
      })),
    })
  }

  // Fusión de turnos consecutivos del mismo rol, para no dejar dos 'model'
  // seguidos (que es lo que pasaba cuando confirmar agregaba un segundo mensaje
  // de asistente al chat).
  //
  // PERO un turno de functionResponse no se fusiona con nada: Gemini devolvió
  // 400 cuando el functionResponse viajaba en las mismas `parts` que el texto
  // nuevo del usuario. Un content con functionResponse tiene que llevar SÓLO
  // functionResponse. Eso deja dos turnos 'user' seguidos —el resultado de la
  // tool y lo que el usuario escribió después—, que es lo correcto acá: no hay
  // ningún turno del modelo en el medio porque nuestras propuestas cortan el
  // loop y vuelven al cliente en vez de seguir con Gemini.
  //
  // Mezclar texto con functionCall en el turno del modelo sí es válido, y no se
  // toca: es exactamente lo que Gemini emite en sus propios candidates.
  const contents: GeminiContent[] = []
  for (const turno of turnos) {
    const ultimo = contents[contents.length - 1]
    const aislado = tieneFunctionResponse(turno.parts)
    const ultimoAislado = ultimo ? tieneFunctionResponse(ultimo.parts ?? []) : false
    if (ultimo && ultimo.role === turno.role && !aislado && !ultimoAislado) {
      ultimo.parts = [...(ultimo.parts ?? []), ...turno.parts]
    } else {
      contents.push({ role: turno.role, parts: turno.parts })
    }
  }

  return contents
}

function tieneFunctionResponse(parts: GeminiPart[]): boolean {
  return parts.some((p) => p.functionResponse)
}

// Resumen de una línea para el log: la secuencia de roles y cuántas calls se
// reinyectaron. Es lo que permite verificar de un vistazo que la alternancia
// quedó bien (nunca "model,model") sin leer el payload entero.
export function resumenContents(contents: GeminiContent[]): string {
  const roles = contents.map((c) => c.role).join(',')
  let calls = 0
  let responses = 0
  for (const c of contents) {
    for (const p of c.parts ?? []) {
      if (p.functionCall) calls++
      if (p.functionResponse) responses++
    }
  }
  return `turnos=${contents.length} roles=[${roles}] functionCalls=${calls} functionResponses=${responses}`
}
