// Edge Function: send-reminder-notifications
//
// NO la invoca el usuario: la dispara un cron (pg_cron -> net.http_post) cada
// pocos minutos. Corre server-side con el service_role para poder operar sobre
// los recordatorios de todos los usuarios.
//
// Flujo:
//   1. Busca recordatorios con estado='pendiente' y fecha_hora <= now().
//   2. Por cada uno, junta las push_subscriptions del user_id dueño del item.
//   3. Manda la notificación Web Push (npm:web-push) con el contenido del item.
//   4. Si al menos un envío tuvo éxito ->
//        - recordatorio de una sola vez: estado='enviado' (fin);
//        - recordatorio RECURRENTE: fecha_hora avanza a la próxima ocurrencia y
//          el estado vuelve a 'pendiente', listo para la vuelta siguiente.
//   5. Si una suscripción devuelve 410/404 (expiró) -> se borra.
//
// Autenticación del trigger: header `x-cron-secret` que debe coincidir con el
// secret CRON_SECRET. Se despliega con --no-verify-jwt (no hay usuario detrás).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
// Gemelo exacto de src/lib/recurrencia.ts: el mismo recordatorio puede avanzar
// por acá (este cron) o por el cliente (aviso local / "marcar hecho"), y tiene
// que caer en la misma fecha en los dos casos. La paridad está cubierta por
// tests que importan las dos copias y comparan sus salidas.
import { parseRecurrencia, proximaOcurrencia } from './recurrencia.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Resumen textual del contenido de un item para el cuerpo de la notificación.
function resumen(item: { tipo?: string; contenido?: Record<string, unknown> } | null): string {
  if (!item) return 'Tenés un recordatorio pendiente.'
  const c = item.contenido ?? {}
  if (item.tipo === 'lista' && Array.isArray(c.items)) {
    const lineas = (c.items as { texto?: unknown }[])
      .map((l) => String(l.texto ?? ''))
      .filter(Boolean)
    const preview = lineas.slice(0, 3).join(', ')
    return lineas.length > 3 ? `${preview}… (${lineas.length} líneas)` : preview || 'Lista'
  }
  if (typeof c.texto === 'string' && c.texto.trim()) return c.texto.trim()
  return 'Tenés un recordatorio pendiente.'
}

interface RecordatorioRow {
  id: string
  fecha_hora: string
  // null = de una sola vez. Con valor, el recordatorio se reengancha en vez de
  // terminar (ver el update del final del loop).
  recurrencia: string | null
  // Sólo para recurrencia 'dias_semana'. Días EN UTC (0=domingo, escala de
  // getUTCDay()); la conversión desde la zona del usuario ya la hizo el cliente
  // al guardar, así que acá se comparan directo.
  recurrencia_dias: number[] | null
  item: { user_id: string; tipo: string; contenido: Record<string, unknown> } | null
}

interface SubRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

Deno.serve(async (req) => {
  // Guard del trigger: solo el cron (que conoce el secret) puede dispararla.
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'No autorizado.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:recordatorios@organizador.app'

  if (!supabaseUrl || !serviceRoleKey || !vapidPublic || !vapidPrivate) {
    return json({ error: 'Función mal configurada (faltan secrets).' }, 500)
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  // service_role: bypassa RLS para operar sobre todos los usuarios.
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const nowIso = new Date().toISOString()

  const { data: pendientes, error: qError } = await supabase
    .from('recordatorios')
    .select('id, fecha_hora, recurrencia, recurrencia_dias, item:items(user_id, tipo, contenido)')
    .eq('estado', 'pendiente')
    .lte('fecha_hora', nowIso)
    .order('fecha_hora', { ascending: true })

  if (qError) {
    return json({ error: qError.message }, 500)
  }

  const recordatorios = (pendientes ?? []) as unknown as RecordatorioRow[]

  // Cache de suscripciones por usuario para no re-consultar.
  const subsCache = new Map<string, SubRow[]>()
  async function getSubs(userId: string): Promise<SubRow[]> {
    if (subsCache.has(userId)) return subsCache.get(userId)!
    const { data } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)
    const subs = (data ?? []) as SubRow[]
    subsCache.set(userId, subs)
    return subs
  }

  let enviados = 0
  let reenganchados = 0
  let sinSuscripcion = 0
  let expiradasBorradas = 0

  for (const rec of recordatorios) {
    if (!rec.item) continue
    const subs = await getSubs(rec.item.user_id)
    if (subs.length === 0) {
      sinSuscripcion++
      continue // dejamos 'pendiente'; si se suscribe luego, se notifica después
    }

    const payload = JSON.stringify({
      title: 'Recordatorio',
      body: resumen(rec.item),
      url: '/reminders',
      // Mismo tag que usa el aviso local del watcher para este recordatorio: si
      // los dos avisan (el 'enviado' del watcher no había subido todavía porque
      // el dispositivo estaba sin señal), el push reemplaza la notificación
      // local en vez de apilar una segunda.
      tag: `recordatorio-${rec.id}`,
    })

    let algunoOk = false
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        )
        algunoOk = true
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          // Suscripción expirada/inexistente: la borramos y la sacamos del cache.
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          subsCache.set(
            rec.item.user_id,
            subsCache.get(rec.item.user_id)!.filter((s) => s.id !== sub.id),
          )
          expiradasBorradas++
        } else {
          console.error('web-push error', statusCode, (err as Error).message)
        }
      }
    }

    if (algunoOk) {
      // Acá se bifurca lo único que los recordatorios recurrentes cambian de
      // este cron. Uno de una sola vez termina en 'enviado', como siempre. Uno
      // recurrente NO termina: se le adelanta `fecha_hora` a la próxima vuelta
      // y vuelve a 'pendiente', así el próximo ciclo del cron lo vuelve a
      // encontrar cuando corresponda. Es la misma fila de siempre — no se crean
      // filas nuevas por vuelta.
      //
      // `proximaOcurrencia` garantiza una fecha estrictamente futura aunque el
      // recordatorio viniera atrasado (cron caído, dispositivo sin señal): si
      // sólo sumáramos una vuelta, seguiría venciendo y se reenviaría una vez
      // por ciclo hasta alcanzar el presente.
      const recurrencia = parseRecurrencia(rec.recurrencia)
      const siguiente = recurrencia
        ? proximaOcurrencia(rec.fecha_hora, recurrencia, Date.now(), rec.recurrencia_dias)
        : null

      // Guarda anti-bucle (igual que en repo.ts): si el cálculo no avanzó
      // —'dias_semana' sin días utilizables, fecha corrupta—, dejarlo
      // 'pendiente' con la misma fecha vencida lo haría reenviar una vez por
      // ciclo del cron, para siempre. Se cierra como uno de una sola vez.
      const cambios =
        siguiente !== null && siguiente !== rec.fecha_hora
          ? { estado: 'pendiente', fecha_hora: siguiente }
          : { estado: 'enviado' }

      // Sin `updated_at` explícito: el trigger set_updated_at lo estampa con
      // now(), que es lo que necesita el LWW del cliente para adoptar este
      // cambio en la próxima reconciliación.
      await supabase.from('recordatorios').update(cambios).eq('id', rec.id)
      enviados++
      if (cambios.estado === 'pendiente') reenganchados++
    }
  }

  return json({
    ok: true,
    procesados: recordatorios.length,
    enviados,
    // De los enviados, cuántos eran recurrentes y quedaron reprogramados en vez
    // de terminar. Útil para verificar la feature desde la respuesta del cron.
    recurrentes_reenganchados: reenganchados,
    sin_suscripcion: sinSuscripcion,
    suscripciones_expiradas_borradas: expiradasBorradas,
  })
})
