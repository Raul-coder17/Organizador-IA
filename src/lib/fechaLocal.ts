// Aritmética y formato de fecha/hora en la zona del usuario. Sin I/O y sin
// tocar Supabase ni IndexedDB.
//
// Vive aparte de `recordatorios.ts` —que es de donde salió y que sigue
// re-exportando todo esto para no cambiar ningún import— por una razón
// concreta: `recordatorios.ts` importa el cliente de Supabase, y eso hace que
// `deno test` no pueda cargarlo (`import.meta.env` es de Vite, no existe en
// Deno). Estas funciones son puras y se testean con el mismo `deno test` que el
// resto del cálculo de recurrencia, así que necesitan un módulo sin
// dependencias.

// Convierte un ISO (UTC, como lo guarda Postgres) al formato que espera un
// <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"), en hora local.
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Convierte el valor de un datetime-local (hora local, sin zona) a ISO UTC.
export function datetimeLocalToIso(value: string): string {
  return new Date(value).toISOString()
}

// Formato legible para mostrar la fecha/hora de un recordatorio.
export function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Qué recurrencias NO necesitan que nadie elija una fecha.
 *
 * "Diario" se repite todos los días y "días específicos" trae sus propios días:
 * en los dos casos la fecha que el usuario eligiera sería puro ruido — lo único
 * que aporta información es la HORA. "Semanal" y "mensual" sí la necesitan,
 * porque ahí la fecha es la que define qué día de la semana o del mes se repite.
 *
 * Lo usan el form manual y los dos caminos de la IA, así que vive acá: si cada
 * uno decidiera por su cuenta, el asistente podría pedir una fecha que el form
 * ni muestra.
 */
export function recurrenciaSinFecha(r: string | null | undefined): boolean {
  return r === 'diario' || r === 'dias_semana'
}

// La hora ("HH:mm") de un datetime-local, para prellenar el <input type="time">
// cuando se pasa de una recurrencia con fecha a una sin ella.
export function horaDeDatetimeLocal(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(11, 16) : ''
}

/**
 * La PRÓXIMA vez que sean las "HH:mm", como datetime-local ("YYYY-MM-DDTHH:mm").
 *
 * Es la fecha ancla de las recurrencias que no piden fecha —"diario" y "días
 * específicos"—: ahí el usuario (y la IA) sólo eligen hora, pero la base guarda
 * un `fecha_hora` completo igual, así que alguien tiene que calcularlo.
 *
 * Devuelve hoy a esa hora si todavía no pasó, y mañana si ya pasó — nunca algo
 * vencido. Para "días específicos" esto es sólo el punto de partida: después
 * `prepararRecurrencia` lo corre 0 a 6 días con `ajustarADiaMarcado` hasta el
 * próximo día marcado, que por ser posterior o igual sigue estando en el futuro.
 *
 * Se hace con los setters LOCALES (a diferencia de todo `lib/recurrencia.ts`,
 * que es UTC puro) justamente porque acá lo que hay que respetar es el reloj de
 * pared del usuario: "las 7" son las 7 que él ve. El resultado sale como
 * datetime-local, que es el mismo formato que produce el selector de fecha del
 * form, así que de ahí en adelante los dos caminos son idénticos.
 *
 * Devuelve null si la hora no es legible, para que el llamador lo trate como
 * "falta la hora" en vez de guardar un Invalid Date.
 */
export function proximaFechaConHora(hora: string, ahora: Date = new Date()): string | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hora)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null

  const d = new Date(ahora)
  d.setHours(h, min, 0, 0)
  // "<=" y no "<": si es exactamente la hora, el aviso de hoy ya es el de ahora
  // mismo — mejor arrancar mañana que crear algo que vence al instante.
  if (d.getTime() <= ahora.getTime()) d.setDate(d.getDate() + 1)

  return isoToDatetimeLocal(d.toISOString())
}
