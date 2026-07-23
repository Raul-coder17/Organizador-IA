// Lógica pura (sin React ni red) de scheduling de timers del aviso local de
// recordatorios. Se separa acá para poder testearla con `deno test`.
//
// El watcher local (useLocalReminderWatcher) sondea cada pocos segundos los
// recordatorios pendientes que vencen pronto —desde el espejo local, así que
// funciona sin conexión— y arma un setTimeout por cada uno que dispare
// exactamente en su fecha_hora.
//
// Son dos pasos: `splitStaleReminders` aparta los que vencieron hace rato (la
// app estuvo cerrada o sin señal) para resumirlos en un solo aviso, y
// `reconcileTimers` reconcilia el resto contra los timers ya armados: dice
// cuáles armar (nuevos o con la fecha cambiada) y cuáles cancelar (ya no están
// pendientes, o cambiaron de fecha y hay que rearmarlos).

export interface PendingReminder {
  id: string
  fecha_hora: string
}

// Un timer ya armado, con la fecha para la que quedó programado (para detectar
// si el recordatorio cambió de fecha desde entonces).
export interface ArmedTimer {
  id: string
  fechaHora: string
}

export interface ReconcileInput {
  pending: PendingReminder[]
  armed: ArmedTimer[]
  // ids ya disparados en esta sesión (a la espera de que la DB refleje
  // 'enviado'): no se rearman aunque el sondeo todavía los vea pendientes.
  suppressIds: string[]
  now: number
}

export interface ArmInstruction {
  id: string
  fechaHora: string
  delayMs: number
}

export interface ReconcileResult {
  toArm: ArmInstruction[]
  toCancel: string[]
}

// Milisegundos hasta la fecha objetivo, nunca negativo (si ya venció, 0 → el
// timer dispara de inmediato).
export function computeDelayMs(fechaHora: string, now: number): number {
  const target = new Date(fechaHora).getTime()
  if (Number.isNaN(target)) return 0
  return Math.max(0, target - now)
}

// ============================================================
// Catch-up de vencidos viejos (PLAN_OFFLINE.md §6.2)
// ============================================================

export interface SplitStaleInput {
  pending: PendingReminder[]
  // ids ya avisados en esta sesión: no vuelven a contarse como catch-up.
  suppressIds: string[]
  now: number
  // Cuánta demora se considera "normal". Un recordatorio que venció hace menos
  // que esto simplemente cayó entre dos sondeos y se avisa como siempre.
  graceMs: number
}

export interface SplitStaleResult {
  // Siguen el camino normal: se les arma un timer que dispara en su fecha.
  fresh: PendingReminder[]
  // Vencieron hace rato (la app estuvo cerrada o sin señal en su momento). No
  // se avisan de a uno con su contenido, como si acabaran de vencer: se
  // resumen en un solo aviso de catch-up.
  stale: PendingReminder[]
}

// Separa los pendientes en "avisar normal" y "avisar como catch-up".
//
// El motivo: cuando el dispositivo estuvo offline o la app cerrada mientras
// vencían recordatorios, al reabrir el sondeo los ve a todos vencidos. Armarles
// un timer con delay 0 dispararía una ráfaga de avisos con fecha vieja, cada
// uno haciéndose pasar por recién vencido. Un único aviso agregado es más
// honesto y menos molesto; en /reminders siguen apareciendo como vencidos hasta
// que el usuario los marque hechos.
export function splitStaleReminders(input: SplitStaleInput): SplitStaleResult {
  const { pending, suppressIds, now, graceMs } = input
  const suppress = new Set(suppressIds)
  const corte = now - graceMs

  const fresh: PendingReminder[] = []
  const stale: PendingReminder[] = []

  for (const p of pending) {
    const target = new Date(p.fecha_hora).getTime()
    // Una fecha ilegible no puede considerarse "vieja": va por el camino normal
    // (computeDelayMs ya la trata como vencida y dispara enseguida).
    const esViejo = !Number.isNaN(target) && target < corte
    // Los ya avisados en esta sesión no se recuentan: van a fresh, donde
    // reconcileTimers los descarta por suppressIds.
    if (esViejo && !suppress.has(p.id)) stale.push(p)
    else fresh.push(p)
  }

  return { fresh, stale }
}

export function reconcileTimers(input: ReconcileInput): ReconcileResult {
  const { pending, armed, suppressIds, now } = input
  const suppress = new Set(suppressIds)
  const armedById = new Map(armed.map((a) => [a.id, a.fechaHora]))
  const pendingById = new Map(pending.map((p) => [p.id, p.fecha_hora]))

  const toArm: ArmInstruction[] = []
  for (const p of pending) {
    if (suppress.has(p.id)) continue
    const armedFecha = armedById.get(p.id)
    // Armar si no hay timer, o si la fecha programada ya no coincide (el
    // usuario editó el recordatorio) → se cancela abajo y se rearma acá.
    if (armedFecha === undefined || armedFecha !== p.fecha_hora) {
      toArm.push({ id: p.id, fechaHora: p.fecha_hora, delayMs: computeDelayMs(p.fecha_hora, now) })
    }
  }

  const toCancel: string[] = []
  for (const a of armed) {
    const pendingFecha = pendingById.get(a.id)
    // Cancelar si ya no está entre los pendientes (lo marcaron hecho, ya se
    // envió, o cambió de estado), o si cambió de fecha (se rearma en toArm).
    if (pendingFecha === undefined || pendingFecha !== a.fechaHora) {
      toCancel.push(a.id)
    }
  }

  return { toArm, toCancel }
}
