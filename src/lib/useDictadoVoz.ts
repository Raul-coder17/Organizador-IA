import { useEffect, useRef, useState } from 'react'

// Dictado por voz para el input del chat del asistente (ítem del plan:
// "Dictado de voz en el chat del asistente"). Usa la Web Speech API nativa del
// navegador (SpeechRecognition / webkitSpeechRecognition) — sin IA, sin gastar
// cuota de Gemini, todo corre del lado del cliente.
//
// No hay tipos oficiales de TypeScript para esta API (no es estándar, sólo
// Chrome/Edge/Safari-nuevo la implementan con prefijo), así que se declara acá
// el mínimo necesario. Nombres propios (prefijo `Dictado`) para no chocar si
// alguna versión futura de lib.dom.d.ts agrega los suyos.

interface DictadoRecognitionAlternative {
  transcript: string
}
interface DictadoRecognitionResult {
  readonly length: number
  [index: number]: DictadoRecognitionAlternative
}
interface DictadoRecognitionResultList {
  readonly length: number
  [index: number]: DictadoRecognitionResult
}
interface DictadoRecognitionEvent extends Event {
  results: DictadoRecognitionResultList
}
interface DictadoRecognitionErrorEvent extends Event {
  error: string
}
interface DictadoRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: DictadoRecognitionEvent) => void) | null
  onerror: ((ev: DictadoRecognitionErrorEvent) => void) | null
  onend: ((ev: Event) => void) | null
}
type DictadoRecognitionConstructor = new () => DictadoRecognition

function getRecognitionCtor(): DictadoRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: DictadoRecognitionConstructor
    webkitSpeechRecognition?: DictadoRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// Firefox y algunas versiones de Safari/iOS no implementan la API: en vez de
// mostrar un botón que no hace nada, el consumidor usa `soportado` para no
// dibujarlo directamente.
export const dictadoVozSoportado =
  typeof window !== 'undefined' && !!getRecognitionCtor()

export interface DictadoVoz {
  grabando: boolean
  errorPermiso: string | null
  // Arranca a grabar. `onTranscript` recibe, en cada actualización, el texto
  // reconocido HASTA AHORA en esta sesión de grabación (interino + final
  // acumulado) — no un delta — porque la Web Speech API reescribe sus
  // resultados interinos a medida que refina el reconocimiento.
  iniciar: (onTranscript: (texto: string) => void) => void
  detener: () => void
}

export function useDictadoVoz(): DictadoVoz {
  const [grabando, setGrabando] = useState(false)
  const [errorPermiso, setErrorPermiso] = useState<string | null>(null)
  const recognitionRef = useRef<DictadoRecognition | null>(null)

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  function iniciar(onTranscript: (texto: string) => void) {
    if (grabando) return
    const Ctor = getRecognitionCtor()
    if (!Ctor) return

    setErrorPermiso(null)
    const recognition = new Ctor()
    recognition.lang = 'es-ES'
    recognition.continuous = true
    recognition.interimResults = true

    recognition.onresult = (e) => {
      let texto = ''
      for (let i = 0; i < e.results.length; i++) {
        texto += e.results[i][0]?.transcript ?? ''
      }
      onTranscript(texto.trim())
    }
    recognition.onerror = (e) => {
      // 'no-speech' y 'aborted' no son errores que el usuario deba ver: el
      // primero es "no dijiste nada" (el input queda como estaba, sin
      // interrumpir), y el segundo es nuestro propio `stop()`/`abort()`.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setErrorPermiso(
          'Necesitamos permiso para usar el micrófono. Habilitalo en la configuración del navegador para dictar.',
        )
      }
    }
    recognition.onend = () => {
      setGrabando(false)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setGrabando(true)
    } catch {
      // start() puede tirar si ya había una instancia arrancando (doble
      // mousedown/touchstart del mismo gesto en algunos navegadores).
    }
  }

  function detener() {
    recognitionRef.current?.stop()
  }

  return { grabando, errorPermiso, iniciar, detener }
}
