// Cálculo de la "próxima ocurrencia" de un recordatorio recurrente.
//
// OJO — ESTE ARCHIVO TIENE UN GEMELO:
//   supabase/functions/send-reminder-notifications/recurrencia.ts
//
// Los dos tienen que dar EXACTAMENTE el mismo resultado para la misma entrada.
// No comparten código porque corren en runtimes distintos que no se pueden
// importar entre sí (el bundle de Vite en el navegador vs. Deno en el Edge), y
// el mismo recordatorio puede avanzar por cualquiera de los dos caminos:
//   - el cliente, cuando dispara el aviso local o el usuario marca "hecho";
//   - el cron del servidor, cuando manda el push.
// Si divergieran, el MISMO recordatorio caería en fechas distintas según quién
// lo haya avanzado. Cualquier cambio acá va también allá, y los dos tienen
// tests con los mismos casos (recurrencia.test.ts en cada lado).
//
// ---------------------------------------------------------------------------
// Por qué toda la aritmética es en UTC
// ---------------------------------------------------------------------------
// `fecha_hora` se guarda como timestamptz (ISO/UTC). El cliente corre en la
// zona del usuario y el Edge corre en UTC: si acá usáramos los setters locales
// (setDate, setMonth) y allá los UTC, las dos mitades darían resultados
// distintos justo en los bordes de horario de verano. Haciendo TODO en UTC en
// los dos lados, el resultado es idéntico venga de donde venga.
//
// La contra: en una zona CON horario de verano, un "todos los días a las 9"
// pasaría a las 8 o a las 10 al cruzar el cambio de hora, porque sumamos 24 h
// exactas y no "el mismo reloj de pared". Para la zona de esta app (Argentina,
// UTC-3 todo el año) no hay diferencia. Si algún día hay que soportar zonas con
// DST, la corrección va acá y en el gemelo a la vez.

export type Recurrencia = 'diario' | 'semanal' | 'mensual' | 'dias_semana'

export const RECURRENCIAS: Recurrencia[] = ['diario', 'semanal', 'mensual', 'dias_semana']

// Rótulos para el selector del form.
export const RECURRENCIA_LABEL: Record<Recurrencia, string> = {
  diario: 'Diario',
  semanal: 'Semanal',
  mensual: 'Mensual',
  dias_semana: 'Días específicos',
}

// Texto corto para el indicador de las fichas y las filas de recordatorio,
// donde el espacio es poco y ya se entiende que se habla de repetición.
//
// 'dias_semana' NO tiene texto fijo: su marca son los días elegidos ("Lun, Mié,
// Vie"), que salen de `etiquetaDias`. Por eso el valor de acá es un fallback
// que sólo se ve si los días faltaran.
export const RECURRENCIA_CORTA: Record<Recurrencia, string> = {
  diario: 'Cada día',
  semanal: 'Cada semana',
  mensual: 'Cada mes',
  dias_semana: 'Días fijos',
}

// ---------------------------------------------------------------------------
// Días de la semana
// ---------------------------------------------------------------------------
//
// CONVENCIÓN (la misma que documenta la migración): enteros 0-6 con 0=domingo,
// que es la escala de `getUTCDay()`. Son días **en UTC**, no en la zona del
// usuario, porque toda la aritmética de este módulo es en UTC para que las dos
// copias (cliente y Edge) coincidan.
//
// La traducción entre "el lunes que el usuario marcó" y el día UTC guardado la
// hace `diasLocalesAUtc` / `diasUtcALocales`, y sólo la usa el cliente: es el
// único que conoce la zona horaria. El servidor opera siempre en UTC y no
// necesita saber nada de esto.

// Orden de presentación: la semana empieza en lunes (convención local), aunque
// el valor 0 sea domingo. Es el orden en que se dibujan los chips del form y en
// que se listan los días en el indicador.
export const DIAS_ORDEN: number[] = [1, 2, 3, 4, 5, 6, 0]

// Índice = valor del día (0=domingo). Abreviado, que es lo que entra en un chip
// y en la marca de una ficha.
export const DIA_CORTO: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
}

export const DIA_LARGO: Record<number, string> = {
  0: 'domingo',
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábado',
}

// Normaliza lo que venga (de la base, del outbox, de la IA) a un set de días
// válido: enteros 0-6, sin repetidos, ordenados de lunes a domingo, al menos
// uno. Cualquier otra cosa devuelve null, que los llamadores tratan como "esta
// recurrencia no se puede calcular".
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

// "Lun, Mié, Vie" — la marca que reemplaza a "Cada semana" para este tipo.
// Recibe días YA convertidos a la escala local (ver diasUtcALocales).
export function etiquetaDias(dias: number[]): string {
  return DIAS_ORDEN.filter((d) => dias.includes(d))
    .map((d) => DIA_CORTO[d])
    .join(', ')
}

// Cuántos días se corre el día de la semana al pasar de la hora local a UTC
// para ESTE instante: -1, 0 o +1.
//
// En Argentina (UTC-3) da 0 casi todo el día y +1 de 21:00 a 23:59, que ya son
// el día siguiente en UTC. Es el único punto donde el proyecto mira la zona
// horaria del navegador, y existe para que "los lunes a las 22" no termine
// avisando los domingos.
export function corrimientoDiaUtc(instante: Date): number {
  const diff = instante.getUTCDay() - instante.getDay()
  // Al cruzar el borde de la semana la resta da 6 o -6 en vez de -1 o 1.
  if (diff === 6) return -1
  if (diff === -6) return 1
  return diff
}

// Días que el usuario marcó (escala local) → días a guardar (escala UTC).
// `instante` es la fecha/hora elegida: el corrimiento depende de la HORA, así
// que hay que recalcular esto cada vez que la hora cambia.
export function diasLocalesAUtc(diasLocales: number[], instante: Date): number[] {
  const corrimiento = corrimientoDiaUtc(instante)
  return parseDiasSemana(diasLocales.map((d) => (d + corrimiento + 7) % 7)) ?? []
}

// La vuelta: días guardados (UTC) → días para mostrar y para marcar los chips.
export function diasUtcALocales(diasUtc: number[], instante: Date): number[] {
  const corrimiento = corrimientoDiaUtc(instante)
  return parseDiasSemana(diasUtc.map((d) => (d - corrimiento + 7) % 7)) ?? []
}

/**
 * Deja lista una recurrencia para guardar: convierte los días de la escala
 * local (la que eligió el usuario, o la que propuso la IA) a la UTC que guarda
 * la base, y "engancha" la primera fecha al próximo día marcado.
 *
 * Existe porque hay TRES caminos que crean un recordatorio con días —el form
 * manual, la confirmación de un `create` de la IA y la de un `update`— y los
 * tres tienen que hacer exactamente lo mismo. Cuando esto vivía suelto en cada
 * uno, bastaba con olvidarse el enganche en uno para que ese camino guardara
 * una primera fecha en un día que el usuario no había marcado.
 *
 * @param fechaIso la fecha/hora elegida, ya en ISO/UTC
 * @param diasLocales días 0-6 en la zona del usuario (0=domingo)
 */
export function prepararRecurrencia(
  fechaIso: string,
  recurrencia: Recurrencia | null,
  diasLocales: number[] | null | undefined,
): { fechaIso: string; recurrencia: Recurrencia | null; diasUtc: number[] | null } {
  if (recurrencia !== 'dias_semana') {
    return { fechaIso, recurrencia, diasUtc: null }
  }

  const instante = new Date(fechaIso)
  const locales = parseDiasSemana(diasLocales)
  // Sin días válidos no hay recurrencia posible: degrada a "una sola vez" en vez
  // de guardar una fila que después no se puede reprogramar.
  if (!locales || !Number.isFinite(instante.getTime())) {
    return { fechaIso, recurrencia: null, diasUtc: null }
  }

  const diasUtc = diasLocalesAUtc(locales, instante)
  if (diasUtc.length === 0) return { fechaIso, recurrencia: null, diasUtc: null }

  return {
    fechaIso: ajustarADiaMarcado(fechaIso, diasUtc),
    recurrencia: 'dias_semana',
    diasUtc,
  }
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/**
 * La marca de "se repite" de un recordatorio, o null si no se repite.
 *
 * Vive acá y no en los componentes porque la usan TRES lugares (la fila de
 * /reminders, la misma fila en Hoy, y la ficha de Biblioteca) y porque para
 * 'dias_semana' hay que convertir los días de UTC a la zona del usuario antes
 * de nombrarlos — si esa conversión se copiara en cada componente, alcanzaría
 * con olvidarla en uno para que la misma repetición se leyera distinto en dos
 * pantallas que se ven a la vez.
 */
export function marcaRecurrencia(rec: {
  recurrencia?: unknown
  recurrencia_dias?: unknown
  fecha_hora: string
}): { corta: string; titulo: string } | null {
  const recurrencia = parseRecurrencia(rec.recurrencia)
  if (!recurrencia) return null

  if (recurrencia === 'dias_semana') {
    const utc = parseDiasSemana(rec.recurrencia_dias)
    // Sin días utilizables no se promete una repetición que el cálculo no puede
    // sostener: no se muestra marca.
    if (!utc) return null
    const locales = diasUtcALocales(utc, new Date(rec.fecha_hora))
    if (locales.length === 0) return null
    return {
      corta: etiquetaDias(locales),
      titulo: `Se repite los ${locales.map((d) => DIA_LARGO[d]).join(', ')}. Al marcarlo hecho se reprograma para el próximo.`,
    }
  }

  return {
    corta: RECURRENCIA_CORTA[recurrencia],
    titulo: `Se repite: ${RECURRENCIA_LABEL[recurrencia].toLowerCase()}. Al marcarlo hecho se reprograma para la próxima vez.`,
  }
}

const DIA_MS = 24 * 60 * 60 * 1000

// Tope defensivo del catch-up de abajo. Con 'diario' cubre ~11 años de atraso;
// con 'mensual', más de 300. Es para que un dato corrupto no cuelgue el hilo,
// no un límite que el uso normal pueda tocar.
const MAX_VUELTAS = 4000

// Lee un valor crudo (de la base, del outbox o de la IA) como Recurrencia.
// Cualquier cosa que no sea uno de los tres valores es "no se repite": una
// recurrencia inventada tiene que degradar a un recordatorio de una sola vez,
// no romper el cálculo.
export function parseRecurrencia(valor: unknown): Recurrencia | null {
  return valor === 'diario' ||
    valor === 'semanal' ||
    valor === 'mensual' ||
    valor === 'dias_semana'
    ? valor
    : null
}

// Avanza UNA vuelta desde `iso`, sin mirar el reloj.
//
// El caso borde que importa es el mensual: el 31 de enero + 1 mes no existe.
// Se recorta al último día del mes destino (31/01 → 28/02, o 29/02 en bisiesto).
// CONSECUENCIA CONOCIDA: ese recorte no se "recuerda". Como la próxima vuelta
// se calcula desde la fecha ya recortada, un mensual del 31 se corre al 28 al
// pasar por febrero y ahí se queda (28/02 → 28/03 → 28/04…), en vez de volver
// al 31. Para que volviera haría falta guardar el día ancla original en una
// columna aparte, que esta versión no tiene.
//
// Una fecha ilegible se devuelve tal cual: mejor dejar el recordatorio como
// estaba que escribirle un "Invalid Date" encima.
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

  // Días específicos: se avanza de a un día hasta caer en el próximo día
  // marcado. Entre 1 y 7 saltos — nunca 0, porque "la próxima vuelta" tiene que
  // ser posterior aunque hoy mismo sea un día marcado (si no, un lunes marcado
  // se quedaría clavado en ese lunes para siempre).
  //
  // Con un solo día marcado da exactamente lo mismo que 'semanal' (7 saltos), y
  // con los siete marcados, lo mismo que 'diario' (1 salto). Esa continuidad es
  // deliberada: no hay combinación que se comporte raro.
  if (recurrencia === 'dias_semana') {
    const marcados = parseDiasSemana(dias)
    // Sin días no hay nada que calcular. Se devuelve la fecha intacta, y quien
    // llama lo detecta porque no avanzó (ver la guarda de `cerrarCiclo`).
    if (!marcados) return iso
    for (let salto = 1; salto <= 7; salto++) {
      const candidato = new Date(ms + salto * DIA_MS)
      if (marcados.includes(candidato.getUTCDay())) return candidato.toISOString()
    }
    return iso
  }

  // Mensual: se conserva el día del mes y la hora, recortando el día si el mes
  // destino es más corto. `Date.UTC` ya resuelve solo el salto de año cuando el
  // mes se pasa de diciembre.
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

// La próxima ocurrencia ESTRICTAMENTE POSTERIOR a `ahoraMs`.
//
// No alcanza con avanzar una sola vuelta: si un "todos los días a las 9" estuvo
// cinco días sin dispararse (app cerrada, sin señal, el cron caído), sumar un
// día lo dejaría todavía en el pasado y volvería a vencer al instante — y otra
// vez, y otra, una por ciclo. Avanzando hasta pasar el ahora, el recordatorio
// atrasado reengancha directo en su próxima vuelta real.
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
    // Si dejó de avanzar (recurrencia incalculable: 'dias_semana' sin días,
    // fecha rota), cortamos acá en vez de girar en falso hasta MAX_VUELTAS.
    if (otra === siguiente) break
    siguiente = otra
  }
  return siguiente
}

// Corre `iso` hacia adelante hasta que caiga en un día marcado, SIN moverlo si
// ya cae en uno (0 a 6 saltos, a diferencia de `avanzarUnaVuelta`, que siempre
// avanza al menos uno).
//
// Es lo que "engancha" la primera ocurrencia: si el usuario elige el martes y
// marca lunes/miércoles/viernes, la primera vez tiene que ser el miércoles, no
// el martes. Sin esto, el primer aviso caería en un día que el usuario no
// marcó y recién a partir del segundo se acomodaría — y además se rompería el
// invariante de que el día de `fecha_hora` siempre está en `recurrencia_dias`.
export function ajustarADiaMarcado(iso: string, dias: number[] | null | undefined): string {
  const base = new Date(iso)
  const ms = base.getTime()
  if (!Number.isFinite(ms)) return iso

  const marcados = parseDiasSemana(dias)
  if (!marcados) return iso

  for (let salto = 0; salto <= 6; salto++) {
    const candidato = new Date(ms + salto * DIA_MS)
    if (marcados.includes(candidato.getUTCDay())) return candidato.toISOString()
  }
  return iso
}
