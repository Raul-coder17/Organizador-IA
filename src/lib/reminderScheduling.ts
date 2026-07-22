// Lógica pura (sin React ni red) de scheduling de timers del aviso local de
// recordatorios. Se separa acá para poder testearla con `deno test`.
//
// El watcher local (useLocalReminderWatcher) sondea cada pocos segundos los
// recordatorios pendientes que vencen pronto y arma un setTimeout por cada uno
// que dispare exactamente en su fecha_hora. Esta función reconcilia el estado
// deseado (los pendientes que trajo el sondeo) contra los timers ya armados:
// dice cuáles armar (nuevos o con la fecha cambiada) y cuáles cancelar (ya no
// están pendientes, o cambiaron de fecha y hay que rearmarlos).

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
