// Freno proactivo de RPM: ventana deslizante de los últimos `windowMs`.
// Lógica pura (sin I/O) para poder testearla con `deno test`, igual que
// actions.ts. El caller (index.ts) es quien lee las marcas de ai_call_log,
// llama a esto para decidir, y si `allowed` inserta la marca nueva.

export interface RpmDecision {
  allowed: boolean
  // Sólo tiene sentido cuando allowed === false.
  retryAfterSeconds: number
}

// `recentCallTimestamps` son epoch-ms de llamadas ya registradas para el
// usuario (de cualquier antigüedad: acá se filtran las que ya salieron de la
// ventana, no hace falta que el caller las pre-filtre). Si entran menos de
// `maxRpm` marcas dentro de la ventana, hay lugar. Si no, el segundo en que
// vuelve a haber lugar es cuando la marca más vieja de la ventana cumple
// `windowMs` de antigüedad.
export function decideRpmSlot(
  recentCallTimestamps: number[],
  maxRpm: number,
  windowMs: number,
  nowMs: number,
): RpmDecision {
  const desde = nowMs - windowMs
  const enVentana = recentCallTimestamps.filter((t) => t > desde).sort((a, b) => a - b)

  if (enVentana.length < maxRpm) {
    return { allowed: true, retryAfterSeconds: 0 }
  }

  const masVieja = enVentana[0]
  const retryAfterMs = masVieja + windowMs - nowMs
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
}
