// Paleta de color por tema (PLAN_REDISEÑO.md ítem 6, Fase 2).
//
// REGLA DE SISTEMA (ver index.css): la PRIORIDAD es cálida y vive en el lomo de
// 4px de la ficha; el TEMA es frío y vive en el punto o el chip. Por eso esta
// paleta es entera fría — siete matices entre el verde-agua y el ciruela — y no
// se acerca al rust/gold/slate de prioridad ni al moss de la marca.
//
// Lo que se guarda en `temas.color` es el SLUG, no el color: el valor concreto
// sale de los tokens --color-tema-*, que index.css redefine en modo oscuro. Un
// tema no cambia de dato al cambiar de tema visual.
//
// Módulo PURO (sin IndexedDB, sin red, sin DOM): testeable con `deno test`,
// igual que syncCore.ts y reminderScheduling.ts.

export const COLORES_TEMA = [
  'verde-agua',
  'turquesa',
  'celeste',
  'azul',
  'indigo',
  'violeta',
  'ciruela',
] as const

export type TemaColor = (typeof COLORES_TEMA)[number]

// Etiquetas para el `title`/`aria-label` de cada muestra del selector: sin
// texto, siete círculos son ilegibles para lectores de pantalla.
export const TEMA_COLOR_LABEL: Record<TemaColor, string> = {
  'verde-agua': 'Verde agua',
  turquesa: 'Turquesa',
  celeste: 'Celeste',
  azul: 'Azul',
  indigo: 'Índigo',
  violeta: 'Violeta',
  ciruela: 'Ciruela',
}

export function esColorTema(valor: unknown): valor is TemaColor {
  return typeof valor === 'string' && (COLORES_TEMA as readonly string[]).includes(valor)
}

// Hash estable de un texto (FNV-1a de 32 bits). Solo se usa para desempatar
// colores: no necesita calidad criptográfica, sí ser determinista entre
// dispositivos para que el mismo nombre tienda al mismo color.
export function hashTexto(texto: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Lo mínimo que necesita saber la asignación sobre un tema ya existente.
export interface TemaColorRef {
  color?: string | null
  created_at?: string | null
}

// Color automático para un tema nuevo (decisión D4: automático al crear, con
// opción de cambiarlo después).
//
// Criterio, en orden:
//   1. entre los colores MENOS usados (así la paleta se reparte pareja en vez
//      de amontonarse en los primeros);
//   2. descartando el del último tema creado, para que dos temas seguidos no
//      salgan iguales — que es lo que más se nota;
//   3. desempate por hash del nombre, si hay nombre: el mismo nombre tiende al
//      mismo color en cualquier dispositivo, sin depender del orden de creación.
export function siguienteColorTema(temas: TemaColorRef[], semilla?: string): TemaColor {
  const usos = new Map<TemaColor, number>(COLORES_TEMA.map((c) => [c, 0]))
  let ultimo: TemaColor | null = null
  let ultimoTs = ''

  for (const tema of temas) {
    if (!esColorTema(tema.color)) continue
    usos.set(tema.color, (usos.get(tema.color) ?? 0) + 1)
    const ts = tema.created_at ?? ''
    if (ts >= ultimoTs) {
      ultimoTs = ts
      ultimo = tema.color
    }
  }

  const minimo = Math.min(...usos.values())
  let candidatos = COLORES_TEMA.filter((c) => usos.get(c) === minimo)
  if (candidatos.length > 1 && ultimo) {
    candidatos = candidatos.filter((c) => c !== ultimo)
  }

  if (candidatos.length === 1 || !semilla) return candidatos[0]
  return candidatos[hashTexto(semilla) % candidatos.length]
}

// Color efectivo de un tema para pintar. Tolera la fila sin color: la caché
// local puede tener temas guardados antes de la migración, y hasta la próxima
// reconciliación es preferible un color derivado del id (estable) a un punto
// gris que parezca un error.
export function colorDeTema(tema: { id: string; color?: string | null }): TemaColor {
  if (esColorTema(tema.color)) return tema.color
  return COLORES_TEMA[hashTexto(tema.id) % COLORES_TEMA.length]
}

// El token CSS del color, no el color literal: así el punto se aclara solo en
// modo oscuro. El slug está validado contra la paleta, nunca es texto libre.
export function temaColorVar(color: TemaColor): string {
  return `var(--color-tema-${color})`
}
