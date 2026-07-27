// Edge Function: delete-account
//
// Borra la cuenta del usuario autenticado, entera y para siempre. No hay
// papelera ni deshacer: cuando esta función devuelve `ok`, no queda nada.
//
// Por qué una Edge Function y no el cliente: borrar una fila de `auth.users`
// sólo lo puede hacer el admin API (`auth.admin.deleteUser`), que exige el
// `service_role`. Esa key NUNCA puede vivir en el navegador —quien la tenga
// puede leer y borrar los datos de todos los usuarios—, así que la operación
// tiene que pasar por acá. El `service_role` ya está disponible como variable
// de entorno inyectada por la plataforma (`SUPABASE_SERVICE_ROLE_KEY`, la misma
// que usa `send-reminder-notifications`): no hay ningún secret nuevo que
// configurar.
//
// A QUIÉN se borra: siempre al dueño del JWT, y a nadie más. El id sale de
// `auth.getUser()` sobre el token del pedido; el body NO se lee para nada.
// Aunque alguien mande `{ user_id: "otro" }`, no hay código que lo mire. Esa es
// la única defensa que importa acá, porque el cliente admin bypassa la RLS: si
// el id viniera del body, cualquier usuario autenticado podría borrar a
// cualquier otro.
//
// UN SOLO DELETE, a propósito: no se borran las tablas de datos una por una.
// Las seis tablas del usuario (`temas`, `items`, `user_ai_settings`,
// `ai_usage`, `push_subscriptions`, `ai_call_log`) referencian
// `auth.users (id) on delete cascade`, y `recordatorios` cae por cascada de
// `items`. Verificado en las migraciones antes de escribir esto, no asumido.
// La cascada corre DENTRO de la misma transacción que el DELETE de auth.users,
// así que el borrado es atómico: o se va todo, o no se va nada. Borrar tabla
// por tabla desde acá sería lo contrario —seis pedidos HTTP independientes, y
// una caída en el cuarto dejaría la cuenta viva a medio vaciar, que es
// exactamente lo que hay que evitar.
//
// Y como confiar en la cascada es confiar en el esquema, después del borrado se
// hace un barrido de verificación con el `service_role` (que no ve RLS, así que
// ve TODO lo que hubiera quedado). Si algo sobrevivió, la respuesta lo dice con
// nombre y apellido en vez de contestar `ok` sobre un borrado a medias.

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

// Tablas con `user_id` propio, para el barrido de verificación posterior.
// `recordatorios` no está: no tiene `user_id` (cuelga de `items`), así que si
// `items` quedó en cero no puede quedar ningún recordatorio — la FK
// `item_id not null references items on delete cascade` lo impide.
const TABLAS_DEL_USUARIO = [
  'items',
  'temas',
  'user_ai_settings',
  'ai_usage',
  'push_subscriptions',
  'ai_call_log',
] as const

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
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Función mal configurada (faltan secrets).' }, 500)
  }

  // Cliente "del usuario": sólo sirve para resolver QUIÉN pide el borrado.
  const supabaseUsuario = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: userError,
  } = await supabaseUsuario.auth.getUser()

  if (userError || !user) {
    return jsonResponse({ error: 'Sesión inválida o expirada.' }, 401)
  }

  // A partir de acá, `user.id` es el ÚNICO id que se usa. No se lee el body.
  const userId = user.id

  // Cliente admin: bypassa RLS y habilita el admin API de Auth.
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

  if (deleteError) {
    // Nada se borró (el DELETE es atómico): la cuenta sigue intacta y se puede
    // reintentar. Se dice así, para que el usuario no quede pensando que quedó
    // a mitad de camino.
    return jsonResponse(
      {
        error: 'No se pudo borrar la cuenta. No se borró nada: podés intentar de nuevo.',
        detalle: deleteError.message,
      },
      500,
    )
  }

  // Barrido de verificación. `head: true` + `count: 'exact'` cuenta sin traer
  // filas. Si una consulta falla, no se puede afirmar que la tabla quedó
  // limpia: se reporta igual que si hubieran quedado filas.
  const restos: string[] = []
  for (const tabla of TABLAS_DEL_USUARIO) {
    const { count, error } = await supabaseAdmin
      .from(tabla)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (error) {
      restos.push(`${tabla} (no se pudo verificar: ${error.message})`)
    } else if ((count ?? 0) > 0) {
      restos.push(`${tabla} (${count})`)
    }
  }

  if (restos.length > 0) {
    // La cuenta de Auth ya no existe (el DELETE salió bien), pero algo quedó
    // colgado. Es un 500 y no un `ok` degradado: el frontend tiene que poder
    // distinguirlo sin leer el cuerpo. 207 sería más preciso, pero
    // `functions.invoke` de supabase-js sólo trata como error los >= 400.
    return jsonResponse(
      {
        error:
          'La cuenta se borró, pero quedaron datos sin eliminar. Anotá este mensaje y avisá para limpiarlos a mano.',
        restos,
      },
      500,
    )
  }

  return jsonResponse({ ok: true })
})
