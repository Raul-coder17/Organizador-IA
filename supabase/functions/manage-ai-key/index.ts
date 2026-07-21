// Edge Function: manage-ai-key
//
// Guarda/borra la API key de Gemini del usuario autenticado. La key nunca
// se persiste en texto plano: se valida contra la API de Gemini y se cifra
// con AES-GCM (secret `AI_KEY_ENCRYPTION_SECRET`, definido como secret de
// la función) antes de escribirla en `user_ai_settings`. Ninguna respuesta
// de esta función devuelve la key, ni en texto plano ni cifrada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function encryptApiKey(apiKey: string, secretB64: string): Promise<string> {
  const secretBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('raw', secretBytes, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(apiKey))
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`
}

async function isValidGeminiKey(apiKey: string): Promise<boolean> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  )
  return res.ok
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

  let body: { action?: string; apiKey?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido.' }, 400)
  }

  if (body.action === 'save') {
    const apiKey = body.apiKey?.trim()
    if (!apiKey) {
      return jsonResponse({ error: 'Falta la API key.' }, 400)
    }

    const valid = await isValidGeminiKey(apiKey)
    if (!valid) {
      return jsonResponse({ error: 'La API key no es válida según Gemini.' }, 422)
    }

    const encrypted = await encryptApiKey(apiKey, encryptionSecret)

    const { error: upsertError } = await supabase
      .from('user_ai_settings')
      .upsert({ user_id: user.id, gemini_api_key_encrypted: encrypted, ai_enabled: true }, { onConflict: 'user_id' })

    if (upsertError) {
      return jsonResponse({ error: 'No se pudo guardar la key.' }, 500)
    }

    return jsonResponse({ ok: true, ai_enabled: true })
  }

  if (body.action === 'remove') {
    const { error: upsertError } = await supabase
      .from('user_ai_settings')
      .upsert({ user_id: user.id, gemini_api_key_encrypted: null, ai_enabled: false }, { onConflict: 'user_id' })

    if (upsertError) {
      return jsonResponse({ error: 'No se pudo desactivar la IA.' }, 500)
    }

    return jsonResponse({ ok: true, ai_enabled: false })
  }

  return jsonResponse({ error: 'Acción desconocida.' }, 400)
})
