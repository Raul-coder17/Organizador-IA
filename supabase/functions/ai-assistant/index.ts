// Edge Function: ai-assistant
//
// Asistente de IA (solo texto) con function-calling contra Gemini. Descifra
// la key del usuario, le da a Gemini herramientas para consultar y proponer
// cambios sobre sus items, y devuelve { respuesta_texto, accion_propuesta? }.
//
// Reglas de seguridad clave:
// - Requiere JWT de usuario válido + ai_enabled = true con key guardada.
// - `listItems` (solo lectura) SÍ se ejecuta acá para dar contexto real a
//   Gemini, usando el JWT del usuario => respeta RLS.
// - `proposeCreateItem/proposeUpdateItem/proposeDeleteItem` NO se ejecutan
//   acá: se devuelven al frontend como `accion_propuesta` para que el
//   usuario confirme antes de aplicar el cambio real.
// - La key descifrada nunca se persiste ni se devuelve al cliente.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_MODEL = 'gemini-2.0-flash'
const MAX_TURNS = 5

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function decryptApiKey(payload: string, secretB64: string): Promise<string> {
  const [ivB64, ctB64] = payload.split('.')
  if (!ivB64 || !ctB64) throw new Error('Formato de key cifrada inválido.')
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0))
  const secretBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('raw', secretBytes, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext)
  return new TextDecoder().decode(plaintext)
}

// ---------------------------------------------------------------------------
// Declaración de tools para Gemini (tipos en mayúscula como pide la API)
// ---------------------------------------------------------------------------

const TIPO_ENUM = ['nota', 'recordatorio', 'lista', 'tabla']
const PRIORIDAD_ENUM = ['alta', 'media', 'baja']

const FUNCTION_DECLARATIONS = [
  {
    name: 'listItems',
    description:
      'Consulta los items del usuario. Úsalo para responder preguntas sobre qué tiene guardado y para tener contexto real antes de proponer crear, editar o borrar algo. Es solo lectura.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tema: { type: 'STRING', description: 'Filtra por nombre exacto de tema (opcional).' },
        tipo: { type: 'STRING', enum: TIPO_ENUM, description: 'Filtra por tipo (opcional).' },
        prioridad: { type: 'STRING', enum: PRIORIDAD_ENUM, description: 'Filtra por prioridad (opcional).' },
      },
    },
  },
  {
    name: 'proposeCreateItem',
    description:
      'Propone crear un item nuevo. NO lo crea: el usuario verá un preview y deberá confirmar. Usa esto cuando el usuario pida agregar/guardar algo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tipo: { type: 'STRING', enum: TIPO_ENUM, description: 'Tipo del item.' },
        tema: { type: 'STRING', description: 'Nombre del tema (existente o nuevo). Opcional.' },
        prioridad: { type: 'STRING', enum: PRIORIDAD_ENUM, description: 'Prioridad. Opcional.' },
        contenido: { type: 'STRING', description: 'Contenido en texto del item.' },
      },
      required: ['tipo', 'contenido'],
    },
  },
  {
    name: 'proposeUpdateItem',
    description:
      'Propone editar un item existente (identificado por item_id, que obtenés de listItems). NO lo edita: el usuario confirma primero. Incluí solo los campos a cambiar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_id: { type: 'STRING', description: 'UUID del item a editar (de listItems).' },
        tipo: { type: 'STRING', enum: TIPO_ENUM },
        tema: { type: 'STRING', description: 'Nuevo nombre de tema.' },
        prioridad: { type: 'STRING', enum: PRIORIDAD_ENUM },
        contenido: { type: 'STRING', description: 'Nuevo contenido en texto.' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'proposeDeleteItem',
    description:
      'Propone borrar un item existente (item_id de listItems). NO lo borra: el usuario confirma primero.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_id: { type: 'STRING', description: 'UUID del item a borrar (de listItems).' },
      },
      required: ['item_id'],
    },
  },
]

const SYSTEM_INSTRUCTION = `Sos el asistente del "Organizador Personal IA". Ayudás al usuario a consultar y organizar sus items (notas, recordatorios, listas, tablas) por tema y prioridad. Respondé siempre en español, breve y claro.

Reglas:
- Antes de responder sobre qué tiene guardado, o antes de proponer cambios sobre un item existente, usá listItems para ver datos reales. No inventes items ni ids.
- Tipos válidos: nota, recordatorio, lista, tabla. Prioridades válidas: alta, media, baja (o sin prioridad).
- Cuando el usuario quiera crear, editar o borrar algo, llamá a la función propose correspondiente. Esas acciones NO se ejecutan al instante: el usuario ve un preview y confirma. Después de proponer, decile en una frase qué va a pasar cuando confirme.
- Para editar o borrar necesitás el item_id real (obtenido de listItems). Si no lo tenés, consultá primero.`

// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}
interface GeminiContent {
  role: string
  parts: GeminiPart[]
}

async function callGemini(apiKey: string, contents: GeminiContent[]): Promise<GeminiContent> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`Gemini respondió ${res.status}`)
  }

  const data = await res.json()
  const content = data?.candidates?.[0]?.content
  if (!content) throw new Error('Respuesta de Gemini sin contenido.')
  return content as GeminiContent
}

function textFromParts(parts: GeminiPart[]): string {
  return parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()
}

function firstFunctionCall(parts: GeminiPart[]): { name: string; args: Record<string, unknown> } | null {
  const part = parts.find((p) => p.functionCall)
  return part?.functionCall ? { name: part.functionCall.name, args: part.functionCall.args ?? {} } : null
}

async function execListItems(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data: temas } = await supabase.from('temas').select('id, nombre').eq('user_id', userId)
  const temaMap = new Map((temas ?? []).map((t) => [t.id as string, t.nombre as string]))

  let query = supabase.from('items').select('*').eq('user_id', userId).order('created_at', { ascending: false })

  if (typeof args.tipo === 'string') query = query.eq('tipo', args.tipo)
  if (typeof args.prioridad === 'string') query = query.eq('prioridad', args.prioridad)

  if (typeof args.tema === 'string' && args.tema.trim()) {
    const matches = (temas ?? []).filter((t) => (t.nombre as string).toLowerCase() === args.tema!.toString().toLowerCase())
    if (matches.length === 0) return { items: [] }
    query = query.in('tema_id', matches.map((t) => t.id))
  }

  const { data: items, error } = await query
  if (error) return { error: 'No se pudieron leer los items.' }

  const compact = (items ?? []).map((it) => ({
    id: it.id,
    tipo: it.tipo,
    tema: it.tema_id ? (temaMap.get(it.tema_id) ?? null) : null,
    prioridad: it.prioridad,
    contenido: typeof it.contenido?.texto === 'string' ? it.contenido.texto : it.contenido,
    created_at: it.created_at,
  }))

  return { items: compact }
}

function mapProposedAction(name: string, args: Record<string, unknown>): Record<string, unknown> | null {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

  if (name === 'proposeCreateItem') {
    return {
      tipo_accion: 'create',
      tipo: str(args.tipo) ?? 'nota',
      tema: str(args.tema) ?? null,
      prioridad: str(args.prioridad) ?? null,
      contenido: str(args.contenido) ?? '',
    }
  }

  if (name === 'proposeUpdateItem') {
    const cambios: Record<string, unknown> = {}
    if (str(args.tipo)) cambios.tipo = str(args.tipo)
    if ('tema' in args) cambios.tema = str(args.tema) ?? null
    if (str(args.prioridad)) cambios.prioridad = str(args.prioridad)
    if (str(args.contenido)) cambios.contenido = str(args.contenido)
    return { tipo_accion: 'update', item_id: str(args.item_id) ?? '', cambios }
  }

  if (name === 'proposeDeleteItem') {
    return { tipo_accion: 'delete', item_id: str(args.item_id) ?? '' }
  }

  return null
}

function fallbackText(accion: Record<string, unknown>): string {
  switch (accion.tipo_accion) {
    case 'create':
      return 'Preparé la creación de un item para que la confirmes.'
    case 'update':
      return 'Preparé una edición para que la confirmes.'
    case 'delete':
      return 'Preparé el borrado de un item para que lo confirmes.'
    default:
      return 'Preparé una acción para que la confirmes.'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Falta el header Authorization.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const encryptionSecret = Deno.env.get('AI_KEY_ENCRYPTION_SECRET')
  if (!supabaseUrl || !supabaseAnonKey || !encryptionSecret) {
    return jsonResponse({ error: 'Función mal configurada (faltan secrets).' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return jsonResponse({ error: 'Sesión inválida o expirada.' }, 401)
  }

  // Estado de IA + key cifrada del usuario (respeta RLS con su JWT).
  const { data: settings } = await supabase
    .from('user_ai_settings')
    .select('ai_enabled, gemini_api_key_encrypted')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.ai_enabled || !settings.gemini_api_key_encrypted) {
    return jsonResponse({ error: 'Activá la IA en Settings primero.' }, 400)
  }

  let apiKey: string
  try {
    apiKey = await decryptApiKey(settings.gemini_api_key_encrypted, encryptionSecret)
  } catch {
    return jsonResponse({ error: 'No se pudo descifrar la key. Volvé a guardarla en Settings.' }, 500)
  }

  let body: { messages?: { role?: string; text?: string }[] }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido.' }, 400)
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    return jsonResponse({ error: 'Faltan mensajes.' }, 400)
  }

  const contents: GeminiContent[] = messages
    .filter((m) => typeof m.text === 'string' && m.text.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text as string }],
    }))

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const content = await callGemini(apiKey, contents)
      const call = firstFunctionCall(content.parts)

      if (!call) {
        return jsonResponse({ respuesta_texto: textFromParts(content.parts) || 'Listo.' })
      }

      if (call.name === 'listItems') {
        const result = await execListItems(supabase, user.id, call.args)
        contents.push(content)
        contents.push({
          role: 'user',
          parts: [{ functionResponse: { name: 'listItems', response: result as Record<string, unknown> } }],
        })
        continue
      }

      const accion = mapProposedAction(call.name, call.args)
      if (accion) {
        const texto = textFromParts(content.parts) || fallbackText(accion)
        return jsonResponse({ respuesta_texto: texto, accion_propuesta: accion })
      }

      // Función desconocida: cortamos para no colgar el loop.
      return jsonResponse({ respuesta_texto: textFromParts(content.parts) || 'No pude completar eso.' })
    }

    return jsonResponse({ respuesta_texto: 'No pude terminar de procesar el pedido. Probá reformularlo.' })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Error del asistente.' }, 502)
  }
})
