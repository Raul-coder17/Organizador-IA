// Cálculo de la "próxima ocurrencia" de un recordatorio recurrente — lado Edge.
//
// GEMELO EXACTO de src/lib/recurrencia.ts. Ver ahí la explicación larga; el
// resumen es:
//
//  - Los dos archivos tienen que dar EXACTAMENTE el mismo resultado para la
//    misma entrada, porque el mismo recordatorio puede avanzar por el cliente
//    (aviso local / "marcar hecho") o por este cron, y no puede terminar en dos
//    fechas distintas según quién lo movió.
//  - No comparten código porque son runtimes que no se pueden importar entre sí
//    (bundle de Vite en el navegador vs. Deno acá).
//  - Toda la aritmética va en UTC justamente para que las dos mitades coincidan
//    aunque el cliente corra en otra zona horaria.
//
// Cualquier cambio acá va también en src/lib/recurrencia.ts, y los dos lados
// tienen tests con los mismos casos (recurrencia.test.ts en cada uno).
//
// Se mantiene como archivo separado y sin I/O (nada de Deno.serve ni red) para
// poder testearlo con `deno test` igual que actions.ts / rpm.ts.

export type Recurrencia = 'diario' | 'semanal' | 'mensual' | 'dias_semana'

const DIA_MS = 24 * 60 * 60 * 1000

// Tope defensivo del catch-up: que un dato corrupto no cuelgue la función.
const MAX_VUELTAS = 4000

// Orden de presentación (lunes primero). Acá sólo se usa para normalizar los
// días a un orden estable, no hay UI de este lado.
const DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0]

// Lee un valor crudo de la base como Recurrencia. Cualquier otra cosa (null,
// texto raro) es "no se repite".
export function parseRecurrencia(valor: unknown): Recurrencia | null {
  return valor === 'diario' ||
    valor === 'semanal' ||
    valor === 'mensual' ||
    valor === 'dias_semana'
    ? valor
    : null
}

// Normaliza `recurrencia_dias` de la base: enteros 0-6 (0=domingo, escala de
// getUTCDay()), sin repetidos, ordenados. null si no hay ninguno usable.
//
// CONVENCIÓN: son días de la semana EN UTC, no en la zona del usuario — el
// cliente hace esa traducción antes de guardar. Acá se comparan directo contra
// getUTCDay(), sin conversión de ningún tipo. Ver el gemelo del cliente y la
// migración 20260725160000 para el porqué.
export function parseDiasSemana(valor: unknown): number[] | null {
  if (!Array.isArray(valor)) return null
  const limpios = new Set<number>()
  for (const bruto of valor) {
    const n = typeof bruto === 'number' ? bruto : Number(bruto)
    if (!Number.isInteger(n) || n < 0 || n > 6) continue
    limpios.add(n)
  }
  if (limpios.size === 0) return null
  return DIAS_ORDEN.filter((d) => limpios.has(d))
}

// Avanza UNA vuelta desde `iso`, sin mirar el reloj.
//
// Caso borde del mensual: el 31 de enero + 1 mes no existe, así que se recorta
// al último día del mes destino (31/01 → 28/02, o 29/02 en bisiesto). El
// recorte no se "recuerda": la vuelta siguiente sale de la fecha ya recortada
// (28/02 → 28/03), igual que en el gemelo del cliente.
//
// Una fecha ilegible se devuelve tal cual, para no escribir un "Invalid Date"
// encima de un recordatorio que estaba bien.
export function avanzarUnaVuelta(
  iso: string,
  recurrencia: Recurrencia,
  dias?: number[] | null,
): string {
  const base = new Date(iso)
  const ms = base.getTime()
  if (!Number.isFinite(ms)) return iso

  if (recurrencia === 'diario') return new Date(ms + DIA_MS).toISOString()
  if (recurrencia === 'semanal') return new Date(ms + 7 * DIA_MS).toISOString()

  // Días específicos: de a un día hasta el próximo marcado. Entre 1 y 7 saltos,
  // nunca 0: la próxima vuelta tiene que ser posterior aunque hoy sea un día
  // marcado. Con un solo día equivale a 'semanal'; con los siete, a 'diario'.
  if (recurrencia === 'dias_semana') {
    const marcados = parseDiasSemana(dias)
    // Sin días no se puede calcular: se devuelve la fecha intacta y el llamador
    // lo nota porque no avanzó (ver la guarda del index.ts).
    if (!marcados) return iso
    for (let salto = 1; salto <= 7; salto++) {
      const candidato = new Date(ms + salto * DIA_MS)
      if (marcados.includes(candidato.getUTCDay())) return candidato.toISOString()
    }
    return iso
  }

  const anio = base.getUTCFullYear()
  const mes = base.getUTCMonth()
  const dia = base.getUTCDate()
  // Día 0 del mes siguiente al destino = último día del destino.
  const diasDelMesDestino = new Date(Date.UTC(anio, mes + 2, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      anio,
      mes + 1,
      Math.min(dia, diasDelMesDestino),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  ).toISOString()
}

// ---------------------------------------------------------------------------
// Marca de "se repite" para el cuerpo de la notificación del push
// ---------------------------------------------------------------------------
//
// Gemelo REDUCIDO de marcaRecurrencia() en src/lib/recurrencia.ts: acá sólo
// hace falta el texto corto ("Se repite: Lun, Mié, Vie" / "Se repite: cada
// día"), no el título largo del tooltip, que no tiene sentido en un push.

const DIA_CORTO: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
}

// Mismos textos que RECURRENCIA_CORTA del cliente (src/lib/recurrencia.ts):
// tienen que coincidir letra por letra, porque el cliente arma el cuerpo del
// aviso local pegándole "Se repite: " a este mismo valor (ver
// contenidoNotificacion en src/lib/recordatorios.ts) y acá se hace lo mismo —
// si no coincidieran, el mismo recordatorio se leería distinto según quién
// mandó el aviso.
const RECURRENCIA_CORTA: Record<Exclude<Recurrencia, 'dias_semana'>, string> = {
  diario: 'Cada día',
  semanal: 'Cada semana',
  mensual: 'Cada mes',
}

// "Lun, Mié, Vie" — en orden de semana (lunes primero), igual que el gemelo.
function etiquetaDias(dias: number[]): string {
  return DIAS_ORDEN.filter((d) => dias.includes(d))
    .map((d) => DIA_CORTO[d])
    .join(', ')
}

// Corrimiento UTC → local FIJO para Argentina (UTC-3, sin horario de verano —
// misma asunción que documenta src/lib/recurrencia.ts: "para la zona de esta
// app no hay diferencia"). A propósito NO usa la hora local del servidor (Deno
// corre en UTC y no tiene por qué coincidir con la del usuario): en cambio
// deriva el corrimiento de la hora UTC de la propia fecha, aritmética pura que
// da el mismo resultado sin importar dónde corra este código. Local 21:00 a
// 23:59 en Argentina cae en UTC 00:00-02:59 del día siguiente — ahí el
// corrimiento es +1; el resto del día, 0 (igual que corrimientoDiaUtc en el
// cliente, pero sin depender de Date#getDay() local).
const HORA_UTC_CORRIMIENTO = 3

function diasUtcALocalesArgentina(diasUtc: number[], fechaIso: string): number[] {
  const horaUtc = new Date(fechaIso).getUTCHours()
  const corrimiento = horaUtc < HORA_UTC_CORRIMIENTO ? 1 : 0
  return parseDiasSemana(diasUtc.map((d) => (d - corrimiento + 7) % 7)) ?? []
}

// La marca "Se repite: …" para el cuerpo de la notificación, o null si no se
// repite (o si 'dias_semana' no tiene días utilizables — mismo criterio que el
// cliente: no se promete una repetición que no se puede sostener).
export function marcaRecurrenciaCorta(rec: {
  recurrencia: unknown
  recurrencia_dias: unknown
  fecha_hora: string
}): string | null {
  const recurrencia = parseRecurrencia(rec.recurrencia)
  if (!recurrencia) return null

  if (recurrencia === 'dias_semana') {
    const utc = parseDiasSemana(rec.recurrencia_dias)
    if (!utc) return null
    const locales = diasUtcALocalesArgentina(utc, rec.fecha_hora)
    return locales.length > 0 ? etiquetaDias(locales) : null
  }

  return RECURRENCIA_CORTA[recurrencia]
}

// La próxima ocurrencia ESTRICTAMENTE POSTERIOR a `ahoraMs`.
//
// Avanzar una sola vuelta no alcanza: un recordatorio atrasado (el cron estuvo
// caído, el dispositivo sin señal) quedaría igual en el pasado y volvería a
// vencer al instante, una vez por ciclo del cron. Avanzando hasta pasar el
// ahora, reengancha directo en su próxima vuelta real.
export function proximaOcurrencia(
  iso: string,
  recurrencia: Recurrencia,
  ahoraMs: number,
  dias?: number[] | null,
): string {
  if (!Number.isFinite(new Date(iso).getTime())) return iso

  let siguiente = avanzarUnaVuelta(iso, recurrencia, dias)
  for (let i = 1; i < MAX_VUELTAS && new Date(siguiente).getTime() <= ahoraMs; i++) {
    const otra = avanzarUnaVuelta(siguiente, recurrencia, dias)
    // Dejó de avanzar (recurrencia incalculable): cortamos en vez de girar en
    // falso hasta MAX_VUELTAS.
    if (otra === siguiente) break
    siguiente = otra
  }
  return siguiente
}
