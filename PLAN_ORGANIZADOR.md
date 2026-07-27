# Organizador Personal IA

> **Flujo de trabajo:** toda sesión nueva debe leer [MAPA_PROYECTO.md](MAPA_PROYECTO.md) primero, antes de explorar el código o usar Grep/Glob directo.

## Objetivo

App PWA para organizar información personal (notas, recordatorios, listas y
tablas) por tema y prioridad, con captura asistida por IA (Gemini) desde
texto o foto.

## Stack elegido

- **Vite + React + TypeScript** — build tool y UI.
- **Tailwind CSS v4** — estilos (vía plugin `@tailwindcss/vite`).
- **Supabase** (`@supabase/supabase-js`) — backend/DB/auth.
- **vite-plugin-pwa** — instalable, offline-first.
- **Gemini API** — captura asistida por IA (texto/foto → estructura).

> **Plan de soporte offline completo**: [`PLAN_OFFLINE.md`](PLAN_OFFLINE.md).
> **Los diez ítems están implementados**: lectura y escritura offline,
> sincronización automática, indicador de estado y recordatorios que avisan sin
> conexión.

## Schema de base de datos

Migración: [`supabase/migrations/20260720120000_schema_inicial.sql`](supabase/migrations/20260720120000_schema_inicial.sql).

### Tablas

- **`temas`** — `id`, `user_id` (fk `auth.users`), `nombre`, `created_at`.
- **`items`** — `id`, `user_id` (fk `auth.users`), `tema_id` (fk `temas`,
  nullable, `on delete set null`), `tipo` (`nota|recordatorio|lista|tabla`),
  `prioridad` (`alta|media|baja`, nullable), `contenido` (jsonb),
  `origen` (`texto|foto|manual`), `created_at`, `updated_at`
  (mantenido por trigger `items_set_updated_at`).
- **`recordatorios`** — `id`, `item_id` (fk `items`, `on delete cascade`),
  `fecha_hora`, `estado` (`pendiente|enviado|hecho`, default `pendiente`),
  `created_at`.

### Decisiones de RLS

- RLS habilitado desde el día uno en las 3 tablas, aunque hoy la app es
  mono-usuario — evita tener que migrar políticas más adelante.
- `temas` e `items` tienen `user_id` propio: las 4 políticas
  (select/insert/update/delete) comparan directo contra `auth.uid()`.
- `recordatorios` **no** tiene `user_id` propio (pertenece a un item, no
  directamente a un usuario). Sus políticas usan un `exists (...)` contra
  `items` para validar que el item asociado sea del usuario autenticado.
  Alternativa descartada: desnormalizar `user_id` en `recordatorios` —
  más rápido de leer pero duplica la fuente de verdad; se prefiere el join
  mientras el volumen de datos sea bajo.
- `items.tema_id` usa `on delete set null` (borrar un tema no debe borrar
  los items, solo desvincularlos). `recordatorios.item_id` usa
  `on delete cascade` (un recordatorio no tiene sentido sin su item), tal
  como se especificó.
- `user_id` en `temas`/`items` usa `on delete cascade` contra
  `auth.users`: si se borra la cuenta, se borran sus datos.

### Índices

- `items(user_id, tema_id)` y `items(user_id, tipo)` — listados filtrados
  por usuario, con o sin filtro de tema/tipo.
- `recordatorios(fecha_hora)` — soporta el query de notificaciones
  pendientes (`where fecha_hora <= now()`). Sigue sirviendo igual para los
  recurrentes: no son filas aparte, es la misma fila con la fecha adelantada.

### Columnas agregadas después del schema inicial

- `recordatorios.updated_at` (2026-07-22) — LWW del motor de sync offline.
- `recordatorios.recurrencia` (2026-07-25) — `null` = una sola vez;
  `diario`/`semanal`/`mensual`/`dias_semana` = al cumplirse, avanza `fecha_hora`
  y vuelve a `pendiente`. Ver "Recordatorios recurrentes".
- `recordatorios.recurrencia_dias` (2026-07-25) — sólo con `dias_semana`: qué
  días, como enteros 0-6 con 0=domingo **en UTC**. Ver la convención en
  "Recordatorios recurrentes"; no es la escala local del usuario.

### Cómo aplicar la migración

1. `npx supabase login` y `npx supabase link --project-ref <ref>`.
2. `npx supabase db push` — aplica todas las migraciones de
   `supabase/migrations/` al proyecto remoto.
3. Alternativa sin CLI: pegar el contenido del archivo `.sql` en el
   SQL Editor del dashboard de Supabase y ejecutarlo una vez.
4. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env`
   (a partir de `.env.example`) con las credenciales del proyecto.

### Estado: aplicado y validado en vivo ✅ (2026-07-21)

- Proyecto Supabase real: `uesnorbrpeosynabobha` ("Organizador Personal IA",
  región `ca-central-1`), linkeado con `supabase link --project-ref`.
- `supabase db push` aplicó `20260720120000_schema_inicial.sql` sin errores.
  `supabase migration list` confirma local y remoto en `20260720120000`.
- Validado en vivo vía `supabase db query --linked` contra
  `pg_tables`/`pg_policies`: las 3 tablas (`temas`, `items`,
  `recordatorios`) existen en `public` con `rowsecurity = true` y 4
  políticas cada una (select/insert/update/delete).

## Autenticación + CRUD manual (sin IA)

UI mínima para validar el modelo de datos end-to-end, sin lógica de IA
todavía.

### Qué se implementó

- **Auth** (`src/lib/AuthContext.tsx`) — `AuthProvider`/`useAuth` con
  `supabase.auth.getSession()` + `onAuthStateChange`. `src/pages/AuthPage.tsx`
  tiene un único form que alterna login/signup (email + password).
  `src/components/ProtectedRoute.tsx` muestra `AuthPage` si no hay sesión,
  un loader mientras se resuelve, o el contenido protegido si hay sesión.
- **Data layer** — `src/lib/temas.ts` (`listTemas`, `createTema`) y
  `src/lib/items.ts` (`listItems`, `createItem`, `updateItem`,
  `deleteItem`), llaman directo a `supabase-js`; RLS hace el filtrado por
  usuario del lado del servidor (las queries igual filtran por `user_id`
  para aprovechar los índices).
- **CRUD de items** (`src/pages/ItemsPage.tsx` + `src/components/ItemForm.tsx`
  + `src/components/ItemList.tsx`) — lista agrupada por tema con filtro
  (todos / sin tema / por tema), formulario único para crear y editar
  (tipo, tema existente o "crear tema nuevo" inline, prioridad, contenido
  en textarea), editar/eliminar por item, botón de cerrar sesión.
- **Contenido como jsonb** — el textarea es texto plano; se guarda como
  `{ texto: "..." }` en la columna `contenido` (jsonb). Es un placeholder
  intencional hasta que haya UI diferenciada por tipo — mantiene el campo
  jsonb "not null" satisfecho sin necesitar estructura real todavía.
- **Estados** — loading (carga inicial), error (mensaje inline, no rompe
  la pantalla), lista vacía (mensaje distinto si no hay items vs. si el
  filtro no matchea nada).

### Verificación de RLS

- **Verificado (estructural, sin tocar cuentas):** releí las 12 policies
  en vivo vía `supabase db query --linked` contra `pg_policies`
  (`qual`/`with_check`). Las 8 de `temas`/`items` son
  `user_id = auth.uid()`; las 4 de `recordatorios` son
  `exists (select 1 from items where items.id = recordatorios.item_id
  and items.user_id = auth.uid())`. RLS está habilitado en las 3 tablas.
  Esto confirma que la lógica de aislamiento es correcta a nivel de base
  de datos, independientemente de la UI.
- **Pendiente (prueba end-to-end con 2 usuarios reales):** no creé cuentas
  de test yo mismo — crear cuentas y autenticar con contraseñas son
  acciones que tengo prohibido ejecutar por mi cuenta, incluso para datos
  de prueba descartables. Para cerrar esta verificación: creá dos cuentas
  de prueba desde la pantalla de login de la app (ej. dos pestañas o una
  en incógnito), cargá un item con cada una, y confirmá que cada usuario
  solo ve los suyos. Si querés, después de eso puedo correr un chequeo
  SQL cruzado usando los `id` de `auth.users` resultantes (sin tocar
  contraseñas) para reforzar la validación.
- Probado en navegador: sin sesión, la app muestra `AuthPage` (login);
  el toggle a "Crear cuenta" cambia el formulario correctamente; sin
  errores de consola.

## Settings de IA — API key de Gemini cifrada

La IA es opcional: cada usuario carga su propia API key de Gemini en
`/settings`. Este ítem es solo la configuración — el asistente/chat en sí
y el function-calling contra items vienen en el próximo ítem.

### Diseño de cifrado

- La key **nunca** viaja ni se guarda en texto plano fuera del momento en
  que el usuario la pega en el input y se envía por HTTPS a la Edge
  Function. El navegador no la persiste (no `localStorage`, no estado
  global fuera del form).
- Migración: [`supabase/migrations/20260721052248_user_ai_settings.sql`](supabase/migrations/20260721052248_user_ai_settings.sql) —
  tabla `user_ai_settings` (`user_id` pk/fk `auth.users`,
  `gemini_api_key_encrypted` text nullable, `ai_enabled` boolean default
  `false`, `updated_at` con el mismo trigger `set_updated_at()` del
  schema inicial). RLS: 4 policies `user_id = auth.uid()` (select/insert/
  update/delete), igual que `temas`/`items`.
- Edge Function [`supabase/functions/manage-ai-key/index.ts`](supabase/functions/manage-ai-key/index.ts)
  (Deno, desplegada en el proyecto real):
  - Verifica el JWT: crea un cliente `supabase-js` con la anon key y el
    header `Authorization` del request, y llama a `supabase.auth.getUser()`.
    Si no hay usuario válido, `401`. El proyecto además tiene
    `verify_jwt: true` a nivel de plataforma (capa extra antes de que el
    request llegue al código).
  - **Acción `save`**: valida la key pegándole a
    `GET https://generativelanguage.googleapis.com/v1beta/models?key=...`
    (si Gemini no responde `ok`, `422` sin guardar nada). Si es válida,
    cifra con **AES-256-GCM** (Web Crypto API nativa de Deno): secret de
    32 bytes random (`AI_KEY_ENCRYPTION_SECRET`, definido como secret de
    la función — nunca en el repo ni en `.env`) importado directo como
    `CryptoKey`, IV random de 12 bytes por operación, y guarda
    `base64(iv).base64(ciphertext)` en `gemini_api_key_encrypted`. Hace
    `upsert` con `ai_enabled = true`.
  - **Acción `remove`**: `upsert` con `gemini_api_key_encrypted = null`,
    `ai_enabled = false`.
  - Ninguna respuesta de la función devuelve la key, ni en texto plano ni
    cifrada — solo `{ ok, ai_enabled }` o `{ error }`.
- La Edge Function usa el JWT del usuario (no service role) para escribir
  en `user_ai_settings`, así que RLS aplica también ahí como capa extra:
  aunque hubiera un bug en el código, la DB igual exige
  `user_id = auth.uid()`.

### Pantalla `/settings`

- Ruta nueva con `react-router-dom` (agregado como dependencia; antes la
  app no tenía router porque solo existía una pantalla protegida).
  `App.tsx`: `AuthProvider` → `ProtectedRoute` → `BrowserRouter` con
  `/` (`ItemsPage`) y `/settings` (`SettingsPage`).
  `src/components/AppNav.tsx` — nav compartida (Items / Settings, email,
  cerrar sesión) usada por ambas páginas.
- `src/pages/SettingsPage.tsx` — lee `ai_enabled` directo de
  `user_ai_settings` (select simple, respetando RLS). Si está inactiva:
  input `type="password"` + botón "Guardar y activar" que llama
  `supabase.functions.invoke('manage-ai-key', { body: { action: 'save', apiKey } })`.
  Si está activa: botón "Desactivar / quitar key" (`action: 'remove'`).
  Maneja loading (carga inicial y submit) y error (mensaje de Gemini si
  la key es inválida, o error genérico de red/servidor).

### Cómo lo desplegué (ya aplicado al proyecto real)

1. `supabase db push` — aplicó la migración de `user_ai_settings`.
2. Generé un secret random de 32 bytes (`openssl`/`crypto.randomBytes`
   equivalente en Node) y lo seteé con
   `supabase secrets set --env-file <temp>` (nunca por línea de comando,
   para que no quede en el historial de shell) — el archivo temporal se
   borró inmediatamente después. `supabase secrets list` solo expone un
   hash SHA-256 de verificación, nunca el valor real.
3. `supabase functions deploy manage-ai-key --use-api` — desplegué sin
   Docker (no estaba corriendo el daemon local) usando el bundler
   server-side de la API de Supabase. Confirmado `status: ACTIVE`.

### Verificación

- **Guard de auth, probado en vivo sin crear ninguna cuenta:** un POST
  sin `Authorization` → `401`. Un POST con la **anon key** como bearer
  (JWT válido para la plataforma pero sin usuario real) → `401
  "Sesión inválida o expirada."` desde mi propio chequeo de
  `getUser()`. Confirma las dos capas (gateway + código) sin tocar
  contraseñas ni crear usuarios.
- **Tabla real:** `user_ai_settings` existe en `public`, `rowsecurity =
  true`, 4 policies.
- **Cifrado validado en vivo con key real ✅ (2026-07-21):** Raúl guardó
  su key de Gemini real desde `/settings`. `select user_id,
  gemini_api_key_encrypted, ai_enabled, updated_at from user_ai_settings;`
  devuelve una sola fila: `ai_enabled = true` y
  `gemini_api_key_encrypted` = un blob `base64(iv).base64(ciphertext)`
  (16 caracteres de IV + separador `.` + ciphertext con padding `==`),
  formato exactamente igual al que arma la función — ningún fragmento
  legible de la key original en ningún campo. Verificado sin loguearme
  con ninguna cuenta, solo leyendo la tabla vía SQL admin.
- `npm run build` sin errores (`tsc -b && vite build`).

## Asistente de IA con function-calling (solo texto)

Conecta la key cifrada de cada usuario a un asistente que puede ver, crear,
editar y borrar items — siempre con **preview y confirmación explícita**
antes de aplicar cualquier cambio. No incluye captura por foto ni
recordatorios/notificaciones todavía.

### Edge Function `ai-assistant`

[`supabase/functions/ai-assistant/index.ts`](supabase/functions/ai-assistant/index.ts) (Deno):

- **Guards:** verifica el JWT (igual que `manage-ai-key`); lee
  `user_ai_settings` con el JWT del usuario (respeta RLS) y si
  `ai_enabled = false` o no hay key guardada devuelve
  `400 "Activá la IA en Settings primero."`.
- **Descifrado:** descifra la key con AES-256-GCM usando
  `AI_KEY_ENCRYPTION_SECRET` (el mismo secret que usó `manage-ai-key`
  para cifrar). La key descifrada vive solo en memoria durante el request
  — nunca se persiste ni se devuelve al cliente.
- **Function-calling contra Gemini** (`gemini-2.5-flash`, configurable en
  la constante `GEMINI_MODEL`): declara 4 tools:
  - `listItems(tema?, tipo?, prioridad?)` — **solo lectura, se ejecuta
    server-side** con el cliente Supabase del usuario (RLS aplica). Le da
    a Gemini datos reales antes de responder o proponer. Devuelve los
    items en forma compacta (con el nombre del tema resuelto).
  - `proposeCreateItem`, `proposeUpdateItem`, `proposeDeleteItem` — **NO
    se ejecutan acá**. Cuando Gemini llama a una de estas, la función la
    mapea a un objeto `accion_propuesta` (JSON) y lo devuelve al frontend
    para preview/confirmación.
- **Loop acotado** (`MAX_TURNS = 5`): mientras Gemini pida `listItems`, se
  ejecuta, se le devuelve el resultado como `functionResponse` y se vuelve
  a llamar; corta al primer `propose*` (devuelve la acción) o al primer
  texto sin function-call.
- **Respuesta:** `{ respuesta_texto, accion_propuesta? }`. La API de
  Gemini nunca ve el `service_role`; todo va con el JWT del usuario, así
  que RLS es la última línea de defensa incluso desde el server.

### Frontend — `/assistant`

- `src/pages/AssistantPage.tsx` — chat con historial en estado local (no
  persistido en DB todavía). Cada mensaje se manda con todo el historial a
  la Edge Function vía `supabase.functions.invoke('ai-assistant')`.
- Cuando la respuesta trae `accion_propuesta`, se renderiza una tarjeta
  ámbar clara ("Vas a crear/editar/borrar esto: …") con botones
  **Confirmar / Cancelar**. Para editar/borrar, la tarjeta muestra el
  contenido *actual* del item afectado (se cargan items+temas al montar).
- **Al confirmar**, el frontend ejecuta el cambio real reusando las mismas
  funciones del CRUD manual (`createItem`/`updateItem`/`deleteItem` de
  `src/lib/items.ts`), resolviendo el nombre de tema a `tema_id` (creándolo
  si no existe, igual que el form manual). Los items creados por IA llevan
  `origen = 'texto'`. **Nada se ejecuta hasta el click en Confirmar.**
- **Al cancelar**, se descarta la acción y se deja una nota en el chat; no
  se toca la DB.
- `src/lib/useAiEnabled.ts` — hook que lee `ai_enabled`. `AppNav` muestra
  el link "Asistente" habilitado solo si la IA está activa; si no, lo
  muestra atenuado y lleva a `/settings`. La propia `/assistant` también
  guarda: si `ai_enabled = false`, muestra un mensaje invitando a activarla
  (defensa en profundidad con el guard del server).

### Verificación

- **Guards, probados en vivo sin login:** POST sin `Authorization` → `401`;
  POST con la anon key como bearer (sin usuario real) → `401 "Sesión
  inválida o expirada."`. Función `ACTIVE` en el proyecto real.
- **Separación lectura vs. escritura (por diseño, verificable en código):**
  `listItems` es la única tool que se ejecuta dentro de la Edge Function
  (`execListItems`); las tres `propose*` solo se mapean a JSON y se
  devuelven — no hay ninguna llamada a `insert/update/delete` en el server.
  El único punto donde se escribe en la DB es el handler `handleConfirm`
  del frontend, detrás del botón Confirmar.
- **Pendiente de tu lado — la prueba end-to-end real:** no puedo mandar un
  mensaje al asistente sin loguearme con tu cuenta (necesita tu sesión + tu
  key), algo que tengo prohibido hacer. Con tu cuenta, probá: (a) "¿qué
  items tengo?" → debe responder consultando, **sin** tarjeta de
  confirmación; (b) "agregá una nota que diga X" → debe aparecer la tarjeta
  de preview y **no** crear nada hasta que toques Confirmar. Avisame y, si
  querés, verifico por SQL que el item recién creado tenga `origen='texto'`
  y aparezca solo tras tu confirmación.
- `npm run build` sin errores.

### Bug: candidate de Gemini sin `parts` (causa raíz confirmada)

- **Síntoma:** al mandar un mensaje en `/assistant`, la función devolvía
  `502` y el frontend mostraba `Cannot read properties of undefined
  (reading 'find')`.
- **Causa raíz:** `firstFunctionCall(content.parts)` asumía que un candidate
  de Gemini siempre trae `parts`. Con `gemini-2.5-flash` (modelo "thinking")
  y function-calling, el modelo gastaba el budget de salida razonando y
  devolvía un candidate **sin `parts`** y `finishReason = MAX_TOKENS`;
  `parts.find(...)` sobre `undefined` lanzaba `TypeError`, que el catch
  del handler convertía en `502`. (Se confirmó exponiendo el error real en
  el frontend en el paso previo de instrumentación.)
- **Fix aplicado:**
  1. `callGemini` ahora devuelve el candidate completo (`content` +
     `finishReason`), y el loop **guarda el caso sin `parts`**: loguea el
     candidate entero con su `finishReason` (`console.error`) y responde
     **200** con un mensaje claro (`messageForFinishReason`): MAX_TOKENS →
     "la respuesta se cortó por límite de tokens…", SAFETY → "Gemini
     bloqueó la respuesta por contenido…", otro → mensaje genérico con el
     `finishReason`. Ya no explota ni devuelve 502 por esto.
  2. Se agregó `generationConfig` al request: `maxOutputTokens: 2048` y
     `thinkingConfig: { thinkingBudget: 0 }` para **desactivar el thinking**
     de 2.5-flash — así el budget de salida queda para la respuesta real,
     que es la causa de fondo del MAX_TOKENS. (Un asistente de
     function-calling con respuestas cortas no necesita razonamiento
     interno extendido.)
- Redeploy `--use-api` (versión 4, `ACTIVE`); build sin errores.

### Errores de Gemini traducidos al español

- **Problema:** ante un no-2xx de Gemini (ej. 429 de cuota), el frontend
  mostraba el JSON crudo de la API de Google, en inglés e ilegible para el
  usuario.
- **Fix:** en `ai-assistant`, `callGemini` ya no propaga el body crudo. Una
  función `translateGeminiError(status, body)` clasifica el error y lanza un
  `GeminiError` con mensaje en español; el catch del handler devuelve ese
  mensaje (y para errores inesperados no-Gemini, un genérico en español —
  nunca JSON crudo). El body real se sigue logueando con `console.error`
  para diagnóstico. Mapeo:
  - `429` / `RESOURCE_EXHAUSTED` → "Se alcanzó el límite de uso de la IA por
    ahora. Intentá de nuevo en unos minutos, o revisá tu plan de Gemini…".
  - `400` con `reason = API_KEY_INVALID` → "Tu API key de Gemini no es
    válida. Revisá la key en Configuración." (un `400` genérico que **no**
    sea de key cae al mensaje genérico, no culpa a la key).
  - `403` / `PERMISSION_DENIED` → "Tu cuenta de Gemini no tiene acceso a
    este modelo. Revisá tu plan en Google AI Studio."
  - `500`/`503` → "El servicio de IA está teniendo problemas ahora mismo.
    Intentá de nuevo en un momento."
  - Otro no-2xx → "Hubo un problema con la IA (código N). Intentá de
    nuevo…" (con el status, sin JSON).
- El frontend toma directo el `{ error }` ya traducido de la función (vía
  `error.context`, porque `supabase-js` esconde el body en `error.message`);
  no vuelve a parsear JSON de Gemini.
- **Probado en vivo:** función `ACTIVE` (versión 5), guard de auth intacto
  (401 sin sesión) → el flujo exitoso no se rompió. La lógica de
  `translateGeminiError` se verificó con un test unitario sobre 8 bodies de
  error reales (429, 400 key, 400 genérico, 403, 500, 503, 404, body
  no-JSON) — todos mapean al mensaje esperado. No se pudo forzar un 429 real
  (la cuota se reinició), pero el mapeo quedó verificado por código.

### Rate limits adaptativos (sin hardcodear el número)

- **Por qué adaptativo:** el límite diario real de Gemini free-tier para
  este proyecto/modelo resultó ser **20/día** (no 250 ni 1500, cifras que
  circulan pero no aplican acá), y ya varió una vez. Hardcodear un número
  quedaría desactualizado apenas Google lo cambie. En vez de eso, el límite
  se **aprende del propio body del 429** (`quotaValue`) y se guarda por
  usuario.
- **Datos** (migración
  [`20260721163051_ai_usage.sql`](supabase/migrations/20260721163051_ai_usage.sql)):
  - `user_ai_settings.daily_quota_learned` (int, nullable) — la cuota diaria
    aprendida del último 429 de tipo día.
  - Tabla `ai_usage (user_id, fecha, requests)` con RLS (3 policies:
    select/insert/update own; no hace falta delete) — contador de llamadas a
    Gemini por día. El **día se calcula en `America/Los_Angeles`**, para que
    el corte coincida con el reset de cuota de Gemini (medianoche del
    Pacífico).
  - RPCs `increment_ai_usage()` (upsert atómico +1, devuelve el total) y
    `ai_usage_today()` (lectura), ambas `security invoker` → respetan RLS.
- **Flujo en `ai-assistant`:**
  1. **Pre-flight:** si `daily_quota_learned` ya se conoce y
     `ai_usage_today() >= daily_quota_learned`, responde al instante
     ("Ya usaste tus N mensajes de IA de hoy. Volvé mañana…") **sin llamar
     a Gemini** — no gasta una request que igual daría 429.
  2. Cada llamada **exitosa** a Gemini incrementa `ai_usage` (contamos
     llamadas reales a la API, que es la unidad de la cuota; un mensaje con
     round-trip de `listItems` puede contar 2).
  3. **429 real:** se parsea el body (`parseRateLimit`) — extrae `quotaId`,
     `quotaValue` y `retryDelay`, todo del body, nada asumido:
     - `quotaId` con `PerDay`/`daily` → guarda `quotaValue` en
       `daily_quota_learned` y responde con el mensaje diario.
     - `quotaId` con `PerMinute`/`PerSecond` (o retryDelay corto) → responde
       con el `retryDelay` real y el frontend deshabilita el input con una
       cuenta regresiva.
     - Sin `quotaId` claro → conservador: se trata como diario si el
       retryDelay es largo, como corto si es ≤120s.
- **Frontend:** el input se bloquea con cuenta regresiva (`cooldown`) ante
  un rate limit corto; se muestra "N de M mensajes de IA usados hoy" cuando
  ya se conoce la cuota (`usage` en la respuesta).
- **Probado:** migración aplicada (tabla+RLS+columna+2 RPCs verificados en
  vivo por SQL); función `ACTIVE` v6; build sin errores. `parseRateLimit`
  verificado con test unitario sobre 4 bodies con la forma real de Gemini
  (PerDay quotaValue 20 + retry 38s; PerMinute quotaValue 15 + retry 11.5s→12;
  sin quotaId con retry corto; 429 pelado → día conservador) — todos OK.
- **Falta confirmar en vivo (requiere tu cuenta + agotar la cuota real):**
  el ciclo completo end-to-end — que al 429 diario se guarde
  `daily_quota_learned = 20`, que el pre-flight bloquee sin llamar a Gemini a
  partir de ahí, que el contador `ai_usage` suba por request, y que un 429 de
  minuto dispare la cuenta regresiva en el input. La lógica quedó verificada
  por unidad y por esquema, pero disparar un 429 real necesita mandar ~20+
  mensajes logueado con tu key.

## Rediseño visual — sistema de fichas de catálogo

Reemplaza el look genérico (tarjetas blancas + pastillas) por un sistema
editorial/de catálogo en **toda** la app, a partir del mockup aprobado
([`diseño/mockup-organizador.html`](diseño/mockup-organizador.html)).

- **Tokens (Tailwind v4 `@theme` en `src/index.css`):** paper/card/ink/
  ink-soft/line/moss/moss-ink/rust/gold/slate como `--color-*` → generan
  utilidades (`bg-paper`, `text-ink`, `border-line`, `bg-moss`…). En v4 no
  hay `tailwind.config.js`; la personalización va en CSS. Fuentes por
  `<link>` de Google Fonts en `index.html`: **Fraunces** (títulos/brand),
  **IBM Plex Sans** (cuerpo), **IBM Plex Mono** (labels/nav/botones), como
  `--font-fraunces/-sans/-mono`.
- **Componentes** (clases en `index.css` + utilidades): nav con brand
  Fraunces y links mono uppercase tracked (activo con `border-bottom` moss);
  ítems con **borde izquierdo 4px por prioridad** (rust/gold/slate/line),
  tipo como label mono y prioridad como texto mono de color (sin pastillas);
  encabezado de tema en Fraunces + contador mono + hairline que ocupa el
  resto del ancho (`::after flex:1`); botón "Nuevo item" sólido moss,
  radius 2px.
- **Items tipo "tabla":** `ItemList` interpreta el jsonb (`parseTabla`:
  soporta `{columnas|headers, filas|rows}` con filas de arrays u objetos) y
  renderiza un `<table>` real — `thead` fondo paper mono uppercase, zebra
  striping sutil, dentro de un wrapper `overflow-x:auto`. Si el jsonb no es
  tabular (ej. `{texto}`), cae al render de texto.
- **Responsivo (toda la app):** nav y toolbar con `flex-wrap`; ítems pasan
  de fila a columna en móvil (`@media max-width:480px`, acciones al final);
  tablas con scroll horizontal propio.
- **Verificado en el navegador, dos tamaños:**
  - *Desktop:* `AuthPage` en la app real (fuentes cargadas, moss, controles
    `.ctl`/`.btn-moss`); e Items/nav/tabla vía un harness servido con el CSS
    **compilado** del build — nav mono con subrayado activo, hairlines de
    tema, bordes de prioridad gold/rust, y la tabla real con header paper y
    zebra.
  - *~375px:* `AuthPage` sin desborde; en el harness el nav envuelve
    (brand → links → email/logout), los ítems se apilan en columna con las
    acciones al final, la tabla queda contenida y `scrollWidth == clientWidth`
    (sin scroll horizontal de página).
  - *Nota de método:* no puedo autenticarme (login prohibido para mí), así
    que las pantallas logueadas (Items/Asistente/Settings) se verificaron con
    el harness sobre el CSS real compilado, no con datos en vivo. Falta la
    confirmación visual con datos reales de tu sesión.
  - *No se adaptó mal nada* en las pruebas; único matiz: en la tabla a 375px
    las celdas envuelven texto (no llega a hacer scroll horizontal con pocas
    columnas) — el wrapper `overflow-x:auto` queda listo para tablas con
    muchas columnas o tokens largos.

## Tipos de contenido con estructura propia (tabla, lista)

Los tipos de item dejan de ser todos `{ texto }` y ganan estructura donde
tiene sentido.

- **Tabla:** `ItemList` interpreta el jsonb (`parseTabla` para
  `{columnas|headers, filas|rows}`, o `parseTextTable` para texto con pipes/
  markdown, que es como se crean hoy) y renderiza un `<table>` real. Si no
  es tabular, cae a texto. Placeholder de ejemplo en el form.
- **Lista con checkboxes reales:**
  - Forma nueva: `contenido = { items: [{ id, texto, hecho }] }` (`id` con
    `crypto.randomUUID()`). Tipo `LineaLista` en `src/types/database.ts`.
  - `ItemForm`: cuando `tipo === 'lista'` reemplaza el textarea por un
    **editor de líneas** (un input por línea, "+ Agregar línea", botón `×`
    para quitar; no deja borrar la última). Al guardar arma `{ items }` con
    `hecho: false` para líneas nuevas y **preserva `hecho`** de las líneas
    existentes al editar. Los otros tipos siguen igual.
  - `ItemList`: para `tipo === 'lista'` con la forma nueva renderiza cada
    línea con un **checkbox real** (estilado con el sistema: relleno moss +
    check, línea tachada en `slate` cuando está hecha). Al marcar/desmarcar,
    `ItemsPage.handleToggleLinea` hace **UI optimista** (actualiza el estado
    al instante), persiste con `updateItem(id, { contenido })`, y si el
    guardado falla **revierte** el estado y muestra el error.
  - **Compat hacia atrás:** un item `lista` viejo con `{ texto }` (o
    cualquier contenido sin `items`) se muestra como texto plano, sin
    romper y sin migración automática.
- **Fuera de alcance (por ahora):** el asistente de IA sigue usando
  `{ texto }` genérico para todo; que sepa crear/editar listas con esta
  estructura queda para un ítem aparte.
- **Verificado:** `npm run build` sin errores; el parseo de tabla-texto se
  probó con el dato real del usuario (unit test); el render de checkboxes y
  el editor de líneas se verificaron en el harness con el CSS compilado, en
  desktop y ~375px (lista apilada, checks moss, tachado, editor usable).
  **Falta tu prueba en vivo** (ver reporte): crear una lista, marcar/
  desmarcar, recargar y confirmar que el estado persiste.

## Recordatorios — UI y datos (sin notificaciones todavía)

Conecta la tabla `recordatorios` (que existía con RLS desde el schema inicial
pero nunca se había usado) a la UI: poder ponerle fecha/hora a cualquier item y
verlos listados. **Las notificaciones push, el service worker, las VAPID keys y
el cron de Supabase quedan para el próximo ítem** — esto es solo UI + datos.

### Capa de datos — [`src/lib/recordatorios.ts`](src/lib/recordatorios.ts)

- `listRecordatorios()` — trae los recordatorios del usuario ordenados por
  `fecha_hora` ascendente, con el item asociado embebido
  (`select('*, item:items(id, tipo, contenido, tema_id, prioridad)')`). **No
  filtra por `user_id`**: la RLS de `recordatorios` ya restringe a los que
  cuelgan de un item del usuario (y el join a `items` está igualmente
  protegido). Aprovecha el índice `recordatorios(fecha_hora)`.
- `getRecordatorioForItem(itemId)` — el recordatorio (si hay) de un item, para
  prellenar el form al editar.
- `upsertRecordatorio(itemId, fechaHora)` — busca el existente y hace update, o
  insert si no hay (no se usa `upsert` por `item_id` porque no hay unique
  constraint ahí; en esta UI un item tiene a lo sumo un recordatorio).
- `deleteRecordatoriosForItem(itemId)` — borra el recordatorio al desmarcar el
  toggle.
- `marcarHecho(id)` — `estado = 'hecho'`.
- `countRecordatoriosPendientesHoy()` — cuenta pendientes vencidos o que vencen
  hoy (corte = fin del día local), para el badge de la nav.
- Helpers: `isoToDatetimeLocal` / `datetimeLocalToIso` (conversión entre el ISO
  UTC de Postgres y el valor de un `<input type="datetime-local">` en hora
  local), `formatFechaHora` (display legible en español) y `resumenContenido`
  (resumen textual del item para la lista, con caso especial para listas).
- Tipo nuevo `RecordatorioConItem` en `src/types/database.ts` (extiende
  `Recordatorio` con `item` embebido).

### ItemForm — toggle de recordatorio

- Checkbox opcional **"Agregar recordatorio"**, disponible para **cualquier
  tipo** de item (no solo `tipo='recordatorio'`). Al marcarlo aparece un
  `<input type="datetime-local">`.
- Al editar, se carga el recordatorio existente (`getRecordatorioForItem`) y se
  prellenan el toggle y la fecha; se recuerda si el item **ya tenía** uno.
- Al guardar (usando el item recién creado/actualizado, así vale para create y
  edit): marcado con fecha → `upsertRecordatorio` (estado `'pendiente'`);
  desmarcado pero antes existía → `deleteRecordatoriosForItem`; fecha editada →
  el upsert la actualiza. Validación: toggle marcado sin fecha → error inline.

### Pantalla `/reminders` — [`src/pages/RemindersPage.tsx`](src/pages/RemindersPage.tsx)

- Lista los recordatorios ordenados por `fecha_hora` ascendente, mostrando el
  resumen del contenido del item asociado (join) y su tipo.
- **Clasificación visual** con los colores del sistema: `vencido`
  (`fecha_hora < ahora` y estado pendiente) → borde/label **rust**; `proximo` →
  **moss**; `hecho` (estado `'hecho'`) → **slate**, atenuado y tachado. (El
  estado `'enviado'`, que hoy no se produce sin push, se trata como próximo.)
- Botón **"Marcar hecho"** por recordatorio (oculto en los ya hechos) →
  `marcarHecho`, con update optimista del estado local.
- Estados loading / vacío / error acordes al resto de la app.

### AppNav — link + badge

- Link **"Recordatorios"** a `/reminders` (ruta agregada en `App.tsx`).
- Badge rust con el conteo de pendientes vencidos/de hoy
  (`useRecordatoriosBadge`, que recalcula al cambiar de ruta, así vuelve
  actualizado tras marcar alguno como hecho). Se oculta si el conteo es 0.

### Diseño

- Clases nuevas en `index.css`: `.nav-badge`, `.rec-toggle` (con checkbox
  estilado moss igual que las listas), y la familia `.rem*` para la lista
  (bordes izquierdos de 4px por estado, mismo lenguaje que los items). Fuentes,
  colores y look de fichas consistentes con el resto.

### Verificación

- **`npm run build` sin errores** (`tsc -b && vite build`).
- **Visual, con el harness de CSS compilado (no puedo autenticarme):** desktop
  y ~375px. Verificado: nav con badge rust; ficha `vencido` con borde/label
  rust, `proximo` moss, `hecho` slate atenuada+tachada; botón "Marcar hecho";
  toggle del form con checkbox moss + datetime-local estilado. A 375px el nav
  envuelve, las fichas apilan la acción al final y `scrollWidth == clientWidth`
  (sin scroll horizontal de página).
- **Falta tu prueba en vivo** (requiere tu sesión): crear un item marcando
  "Agregar recordatorio" con una **fecha pasada** y confirmar que aparece como
  **vencido** (borde rust) en `/reminders` y en el badge; tocar "Marcar hecho"
  y ver que pasa a `hecho` (tachado) y baja el badge; editar un item para
  cambiar/quitar su fecha y confirmar que el recordatorio se actualiza/elimina.

## Notificaciones push reales para recordatorios

Conecta el ciclo completo: suscripción del navegador → guardar en Supabase →
un cron (cada 5 min) que revisa recordatorios vencidos y dispara la
notificación Web Push real. El estado `'enviado'` de `recordatorios` (que ya
existía en el schema) por fin se usa.

### Claves VAPID

- Par generado localmente con `web-push generate-vapid-keys` (no son
  credenciales de ninguna cuenta; se generan solas). **Pública** →
  `VITE_VAPID_PUBLIC_KEY` en `.env` (no es secreta; también en `.env.example`
  como placeholder). **Privada** → secret de Supabase `VAPID_PRIVATE_KEY`
  (nunca en el repo). Además se setearon `VAPID_PUBLIC_KEY` y
  `VAPID_SUBJECT` (`mailto:`) como secrets para que la función arme el
  `setVapidDetails`, y `CRON_SECRET` para autenticar el trigger del cron.

### Migración — `push_subscriptions`

[`20260721181500_push_subscriptions.sql`](supabase/migrations/20260721181500_push_subscriptions.sql):
tabla `push_subscriptions` (`id`, `user_id` fk `auth.users` on delete cascade,
`endpoint` text **unique**, `p256dh`, `auth`, `created_at`), índice por
`user_id`, RLS con 4 policies `user_id = auth.uid()`. El `endpoint` unique
permite el upsert por endpoint desde el frontend. El service_role de la Edge
Function bypassa RLS para leer/borrar suscripciones de cualquier usuario.

### Service worker propio (injectManifest)

- `vite-plugin-pwa` pasó de `generateSW` a **`injectManifest`**
  (`strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`) para
  poder inyectar handlers propios además del precache de Workbox.
- [`src/sw.ts`](src/sw.ts): `precacheAndRoute(self.__WB_MANIFEST)` +
  `activate` (clients.claim) + **`push`** (parsea `{title, body, url}` y hace
  `showNotification`) + **`notificationclick`** (enfoca una pestaña abierta
  navegándola a `/reminders`, o abre una nueva) + **`message`** (`SKIP_WAITING`,
  ver más abajo).
- Tipado: `src/sw.ts` se excluye de `tsconfig.app.json` (lib DOM) y se compila
  con `tsconfig.worker.json` (lib WebWorker), referenciado desde
  `tsconfig.json`, así `tsc -b` valida el worker sin chocar con el DOM.

### Actualización del SW con aviso (no en silencio)

`registerType` pasó de **`autoUpdate`** a **`prompt`**: un SW nuevo instala y
se queda **esperando** (nunca pisa el que está corriendo solo). El registro ya
no lo auto-inyecta el plugin como script aparte (`registerSW.js` no existe
más en `dist/`) — se hace a mano vía el hook `useRegisterSW` de
`virtual:pwa-register/react`, tipado con `/// <reference types=
"vite-plugin-pwa/react" />` en `vite-env.d.ts`.

- [`src/components/UpdateBanner.tsx`](src/components/UpdateBanner.tsx): usa
  `useRegisterSW()`; cuando hay un SW nuevo esperando (`needRefresh`), dibuja
  una franja fija al pie ("Hay una versión nueva de Organizador" + Ahora no /
  Actualizar) con los tokens del sistema (`--color-card`, `--color-moss`,
  `shadow-float`). "Actualizar" llama `updateServiceWorker(true)`, que manda
  el `postMessage({type:'SKIP_WAITING'})` que escucha `sw.ts` y, tras
  `activate`, recarga solo — sin que el usuario tenga que cerrar la app.
  "Ahora no" solo oculta el aviso (`setNeedRefresh(false)`); el SW sigue
  esperando y se aplica en el próximo reload.
- Montado en [`src/App.tsx`](src/App.tsx), **fuera** de `ProtectedRoute`: el
  SW y su aviso no dependen de haber iniciado sesión (también corre en la
  pantalla de login).
- `render.yaml`: se sacó el header `no-cache` de `/registerSW.js` (ya no
  existe ese archivo); `/sw.js` y `/manifest.json` siguen sin cachear.

### Frontend — Settings › Notificaciones

- [`src/lib/push.ts`](src/lib/push.ts): `isPushSupported`, `getPushStatus`
  (combina `Notification.permission` con si hay suscripción viva),
  `subscribeToPush` (pide permiso, `pushManager.subscribe` con la VAPID public
  key, upsert en `push_subscriptions` por endpoint), `unsubscribeFromPush`, y
  helpers de conversión base64url ↔ Uint8Array para la key y las claves de la
  suscripción.
- [`src/components/PushSettings.tsx`](src/components/PushSettings.tsx): sección
  en `/settings` con botón "Activar notificaciones push" y estados
  **activadas / inactivas / rechazadas / no soportado** (mensajes acordes),
  botón "Desactivar en este dispositivo". Estilada con el sistema (cards,
  botones moss/outline, labels mono).

### Edge Function `send-reminder-notifications` (cron, no la invoca el usuario)

[`supabase/functions/send-reminder-notifications/index.ts`](supabase/functions/send-reminder-notifications/index.ts):

- **Auth del trigger:** header `x-cron-secret` que debe igualar el secret
  `CRON_SECRET`; sin él → `401`. Se desplegó con **`--no-verify-jwt`** (no hay
  usuario detrás; el guard es el secret).
- **Lógica:** con `service_role` (bypassa RLS) busca recordatorios
  `estado='pendiente'` y `fecha_hora <= now()`, con el item embebido
  (`user_id`, `tipo`, `contenido`). Por cada uno junta las
  `push_subscriptions` del dueño (cacheadas por usuario), manda la notificación
  con **`npm:web-push`** (payload `{title, body, url}`, body = resumen del
  contenido). Si **algún** envío tuvo éxito → `estado='enviado'`. Si una
  suscripción devuelve **410/404** (expiró) → la borra. Si el usuario no tiene
  suscripciones, deja el recordatorio en `'pendiente'` (se notificará cuando se
  suscriba). Devuelve un resumen `{procesados, enviados, sin_suscripcion,
  suscripciones_expiradas_borradas}`.

### Cron con pg_cron + pg_net

- Extensiones `pg_cron` (schema `pg_catalog`) y `pg_net` (schema `public`)
  habilitadas en el proyecto real.
- El `CRON_SECRET` se guardó en **Supabase Vault**
  (`vault.create_secret(..., 'cron_secret_reminders')`) para que el comando del
  cron **no** contenga el literal.
- `cron.schedule('send-reminder-notifications-5min', '*/5 * * * *', …)` corre
  `net.http_post` hacia `…/functions/v1/send-reminder-notifications` con el
  header `x-cron-secret` leído de Vault. Job **activo**, jobid 1.

### Verificación

- **`npm run build` sin errores** (`tsc -b` app + worker + `vite build`; el SW
  compila en modo injectManifest, `dist/sw.js` incluye los handlers `push` y
  `notificationclick`).
- **Backend, en vivo (sin crear cuentas ni loguearme):**
  - Guard del cron: POST sin `x-cron-secret` → **401**; con el secret correcto
    → **200** `{"ok":true,"procesados":0,…}` (VAPID + query service_role OK).
  - **Camino DB→función completo:** un `net.http_post` manual (leyendo el
    secret de Vault, idéntico a lo que corre el cron) devolvió
    `net._http_response` con `status_code 200` y el mismo JSON → pg_net, Vault
    y el guard funcionan de punta a punta. El cron usa exactamente ese comando.
  - Migración aplicada; extensiones y job verificados por SQL.
- **UI, con el harness de CSS compilado (no puedo autenticarme):** desktop y
  ~375px — sección "Notificaciones" (inactiva/activada) con botones moss/
  outline, e indicador **"● Notificado"** (moss) en la ficha de un recordatorio
  `enviado`, distinguible de un vencido sin notificar; sin scroll horizontal a
  375px.

### Lo que tenés que hacer vos (no lo puedo hacer yo)

1. **Dar permiso de notificaciones del navegador:** entrá a `/settings`, sección
   Notificaciones, tocá **"Activar notificaciones push"** y aceptá el prompt del
   navegador. Eso crea la fila en `push_subscriptions` (yo no puedo aceptar ese
   permiso ni loguearme). Requiere que la app corra sobre **HTTPS o localhost**
   (Web Push no anda sobre `http://` remoto).
2. **Probar el ciclo end-to-end:** creá un recordatorio con **fecha pasada**
   (o de acá a 1–2 min), esperá a que el cron corra (≤5 min) y deberías recibir
   la notificación; al tocarla, abre/enfoca `/reminders`. En la lista, ese
   recordatorio pasa a mostrar **"● Notificado"** (estado `enviado`) y sigue con
   "Marcar hecho". Para no esperar, avisame y disparo la función manualmente.

## Fix: "Cargando…" pegado en Notificaciones (SW en dev + timeout)

- **Causa raíz:** `navigator.serviceWorker.ready` **no rechaza cuando no hay un
  SW activo — cuelga para siempre**. `getPushStatus()` lo `await`-eaba sin
  timeout en el camino de permiso concedido, así que `status` quedaba en `null`
  → la sección mostraba "Cargando…" indefinidamente. Se disparaba porque en
  `npm run dev` el SW **no se registraba** (faltaba `devOptions.enabled` en la
  config de `vite-plugin-pwa`), y también quedaba frágil en cualquier caso donde
  el SW no llegue a activar. El `try/catch` daba falsa protección: un cuelgue no
  es una excepción. Confirmado con un probe (`serviceWorker.ready` no resolvía
  en 3s en dev; sí en el build de producción).
- **Fix:**
  1. `vite.config.ts`: `devOptions: { enabled: true, type: 'module' }` en
     `VitePWA(...)` → el SW se registra también en dev.
  2. `src/lib/push.ts`: helper `swReadyOrNull()` que carrea
     `navigator.serviceWorker.ready` contra un timeout de 6s
     (`Promise.race`) y devuelve `null` si vence. Los tres usos
     (`getPushStatus`, `subscribeToPush`, `unsubscribeFromPush`) pasan por él:
     `getPushStatus` cae a `'granted'` (nunca queda colgado), `subscribeToPush`
     tira un error claro ("recargá e intentá de nuevo"), `unsubscribeFromPush`
     reconsulta el estado.
  3. `src/components/PushSettings.tsx`: `.catch` en el efecto de montaje → ante
     cualquier rechazo sale de "Cargando…" (a `'default'` + mensaje de error),
     nunca se queda en `null`.
- **Verificado:**
  - **Dev (`npm run dev`):** el probe ahora da `registrationsCount: 1`,
    `active: true`, controller presente y `serviceWorker.ready` → **RESUELVE**
    (`scope http://localhost:5173/`). Módulo carga sin errores de consola.
  - **Timeout probado:** réplica de `swReadyOrNull` contra un `.ready` que nunca
    resuelve → devuelve `null` a ~6.3s en vez de colgar.
  - **Producción (`npm run preview`):** SW `active`, controller, `.ready`
    resuelve → registerSW + injectManifest intactos.
  - `npm run build` sin errores.

## Notificaciones de dos vías (local instantáneo + cron cada 1 min)

Sube la precisión de los avisos de recordatorios sin depender solo del cron.
Ahora hay **dos caminos complementarios** que nunca compiten entre sí:

### Vía A — aviso LOCAL instantáneo (app abierta)

- [`src/lib/useLocalReminderWatcher.ts`](src/lib/useLocalReminderWatcher.ts):
  hook montado **una sola vez** cerca de la raíz vía
  [`src/components/LocalReminderWatcher.tsx`](src/components/LocalReminderWatcher.tsx)
  (dentro de `ProtectedRoute`, así corre solo con sesión y en cualquier
  pantalla — ver [`App.tsx`](src/App.tsx)).
- **Sondeo** cada ~25s (`POLL_MS`): `listRecordatoriosParaDisparo()`
  (en [`recordatorios.ts`](src/lib/recordatorios.ts)) trae los recordatorios
  propios `estado='pendiente'` con `fecha_hora` dentro de los próximos ~2 min
  o ya vencidos, con el item embebido para el cuerpo. La ventana (~2 min) es
  más ancha que el intervalo de sondeo, así ninguno cae entre dos sondeos.
- **Timer por recordatorio:** para cada pendiente sin timer se arma un
  `setTimeout` que dispara **exactamente en su `fecha_hora`** (o de inmediato,
  `delay=0`, si ya venció). Al disparar: muestra la notificación **local** con
  `registration.showNotification` — **mismo formato que el push del servidor**
  (título "Recordatorio", cuerpo = `resumenContenido(item)`, `url:/reminders`,
  `icon/badge`) — y marca el recordatorio `estado='enviado'` **directo contra
  Supabase** con el cliente autenticado (`marcarEnviado`, respeta RLS; el
  `.eq('estado','pendiente')` extra evita pisar un `hecho`). No pasa por la
  Edge Function.
- **Reconciliación de timers** (lógica pura testeable en
  [`reminderScheduling.ts`](src/lib/reminderScheduling.ts)): en cada sondeo,
  `reconcileTimers` compara los pendientes contra los timers armados y decide
  qué **armar** (nuevos, o con la fecha cambiada) y qué **cancelar** (ya no
  están pendientes — lo marcaron hecho / se envió / cambió de estado — o
  cambiaron de fecha y se rearman). Los timers también se limpian al
  desmontar el componente.
- **Anti-duplicado en la MISMA pestaña:** un `Set` `fired` (`suppressIds`)
  marca los ids ya disparados **antes** de esperar la red, así un sondeo que
  todavía los vea pendientes (porque la DB no reflejó `enviado` aún) no los
  rearma. Entre **varias pestañas/dispositivos** está bien que ambos disparen
  el aviso local — no se considera bug.
- **Gate de permiso:** el watcher solo arma/dispara si
  `Notification.permission === 'granted'` (sin permiso no hay nada que
  mostrar). Reusa `swReadyOrNull()` (timeout de 6s) de
  [`push.ts`](src/lib/push.ts) para no colgarse esperando el SW.

### Vía B — cron del servidor cada 1 min (app cerrada)

- El cron de `pg_cron` bajó de `*/5 * * * *` a **`* * * * *`** (cada 1 min)
  como **piso de precisión cuando la app está cerrada**. Se reprogramó con
  `cron.alter_job(job_id := 1, schedule := '* * * * *')` — solo el schedule;
  el `command` (con el `x-cron-secret` leído de Vault) quedó **intacto**.
  El jobname sigue siendo `send-reminder-notifications-5min` (histórico:
  `alter_job` no renombra; es cosmético).
- **Ya no compiten:** como la vía A marca `enviado` apenas dispara, cuando el
  cron corre encuentra ese recordatorio **ya no-pendiente** y no reenvía nada.
  Si la app estaba cerrada, la vía A no corrió y el cron es el que notifica
  (vía push real) — con ≤1 min de atraso en el peor caso.

### RemindersPage / AppNav — sin cambios

El estado `'enviado'` que pone la vía A es idéntico al que ponía el push del
servidor, así que la UI ya lo refleja bien: `RemindersPage` muestra el
indicador **"● Notificado"** ante `estado='enviado'`, y el badge de `AppNav`
(`countRecordatoriosPendientesHoy`, que cuenta solo `pendiente`) baja al
próximo cambio de ruta. Confirmado por lectura de código; no hizo falta tocar
nada.

### Verificación

- **Cron reprogramado, verificado en vivo por SQL:** `cron.job` jobid 1 quedó
  `schedule = '* * * * *'`, `active = true`, con el `command` original
  (net.http_post + `x-cron-secret` de Vault) sin cambios.
- **Lógica de timers:** test unitario `deno test` de `reminderScheduling.ts`
  ([`reminderScheduling.test.ts`](src/lib/reminderScheduling.test.ts)) — **7/7
  pasan**: delay futuro vs. vencido (0), armar nuevo, rearmar al cambiar la
  fecha, cancelar el que ya no está pendiente, no rearmar un id suprimido.
- **`npm run build` sin errores** (`tsc -b` app + worker + `vite build`; el SW
  sigue compilando con sus handlers `push`/`notificationclick`).
- **Pendiente de tu prueba en vivo** (requiere tu sesión + permiso de
  notificaciones ya concedido): con la app **abierta**, creá un recordatorio
  para "en ~30 segundos" y confirmá que la notificación aparece casi al
  instante (sin esperar al cron), que el recordatorio pasa a **"● Notificado"**
  y que el badge de la nav baja. Con la app **cerrada**, un recordatorio
  debería llegar por el cron en ≤1 min.

## Asistente: tools ampliadas (recordatorios, listas, multiacciones)

El asistente pasa de conocer solo `content={texto}` a manejar la estructura
real de **listas** (líneas con checkboxes) y **recordatorios** (tabla aparte),
y a proponer **varias acciones en un mismo turno**. (La memoria de conversación
persistente queda para el próximo ítem.)

### Lógica pura testeable — `actions.ts`

- Se extrajo el parseo/mapeo de function-calls a
  [`supabase/functions/ai-assistant/actions.ts`](supabase/functions/ai-assistant/actions.ts)
  (sin `Deno.serve` ni red), para poder testearlo con `deno test`:
  `allFunctionCalls` (extrae TODAS las calls de un turno, no solo la primera),
  `partitionCalls` (lecturas vs. `propose*`), `mapProposedAction` (con soporte
  de líneas de lista y recordatorio), `collectProposedActions` (arma el array),
  `fallbackTextForActions`.
- Test: [`actions.test.ts`](supabase/functions/ai-assistant/actions.test.ts) —
  **8 casos, todos pasan**: parseo de múltiples function calls en un turno,
  separación lectura/propose, armado del array multiacción, create de lista con
  líneas + recordatorio, create nota + recordatorio, update con marcar/agregar/
  quitar líneas + quitar recordatorio, que las lecturas no producen acciones, y
  la pluralización del texto de fallback.

### Edge Function `ai-assistant`

- **Tools nuevas/ampliadas:**
  - `listRecordatorios(estado?)` — NUEVA, lectura server-side (join a items,
    respeta RLS con el JWT del usuario), para dar contexto de recordatorios.
  - `proposeCreateItem` — ahora acepta `lineas` (array) para tipo `lista` y
    `recordatorio_fecha_hora` (hora local "YYYY-MM-DDTHH:mm") para crear el item
    CON recordatorio en la misma acción. `contenido` ya no es required.
  - `proposeUpdateItem` — ahora acepta `lineas_agregar` / `lineas_quitar` /
    `lineas_marcar_hechas` / `lineas_desmarcar`, y `recordatorio_fecha_hora` /
    `quitar_recordatorio`.
  - `proposeDeleteItem` — sin cambios.
- **Multiacción (parallel function calling):** el loop ahora extrae **todas**
  las function calls del turno. Si hay `propose*`, devuelve **todas** juntas en
  `acciones_propuestas: [...]` (array). Si solo hay lecturas, ejecuta **todas**
  server-side y devuelve un `functionResponse` por cada una para el próximo
  turno. (Prioriza devolver las acciones para no dejar function-calls a medias.)
- **System prompt** dinámico (`buildSystemInstruction`): explica que "lista"
  tiene líneas marcables (no texto), que se puede agregar recordatorio a
  cualquier tipo de item, y que puede proponer varias acciones juntas (con
  ejemplos). Recibe `client_now` (hora local del navegador, que el frontend
  manda en el body) para resolver fechas relativas ("mañana a las 9") — el
  server solo conoce UTC.

### Frontend — `AssistantPage`

- Maneja un **array** de acciones propuestas: una **tarjeta de preview por
  acción**, cada una con **Confirmar/Cancelar individual**, más un botón
  **"Confirmar todas (N)"** que las aplica en secuencia. Cada tarjeta muestra su
  estado final (✓ Aplicado / Cancelado / error) sin bloquear a las demás.
- `applyAction` reusa el CRUD manual (`createItem`/`updateItem`/`deleteItem`,
  RLS) y además: crea listas como `{ items: [{id,texto,hecho}] }`; aplica
  ediciones de líneas partiendo del contenido actual del item (quitar/marcar/
  desmarcar por texto, agregar nuevas); y crea/mueve/quita el recordatorio con
  `upsertRecordatorio`/`deleteRecordatoriosForItem`. La `recordatorio_fecha_hora`
  (local ingenua) se convierte con `datetimeLocalToIso` **al confirmar**, misma
  ruta correcta que el form manual (evita el problema de zona ya diagnosticado).
- Manda `client_now = isoToDatetimeLocal(new Date().toISOString())` en el body.

### Verificación

- **8/8 tests unitarios** (`npx deno test`) — parseo multi-call y armado del
  array de acciones. `npx deno check` de la función: sin errores de tipos.
- `npm run build` sin errores. Función redeployada (incluye `actions.ts`);
  guard de auth intacto (401 sin sesión).
- **Pendiente de tu prueba en vivo** (requiere tu cuenta + tu key): ver abajo.

## Soporte offline — espejo local, outbox y motor de sync

Detalle completo del diseño y del estado de cada ítem en
[`PLAN_OFFLINE.md`](PLAN_OFFLINE.md). Resumen de lo que hay hoy en el código.

### Arquitectura

Las páginas ya **no** hablan con Supabase para leer ni escribir. Hablan con una
capa local sobre IndexedDB, y un motor aparte la sincroniza con el servidor:

```
páginas → repo.ts → IndexedDB (espejo + outbox)
                         ▲
                         │ flush + reconcile
                    sync.ts → Supabase
```

- [`src/lib/db.ts`](src/lib/db.ts) — IndexedDB vía `idb`: stores espejo
  (`temas`, `items`, `recordatorios`), `outbox` (autoincrement = orden FIFO,
  índice compuesto `[entity, entityId]`) y `meta`.
- [`src/lib/repo.ts`](src/lib/repo.ts) — **todas** las mutaciones. Cada una
  escribe el espejo local (UI optimista instantánea), encola la op en el outbox
  y pide un sync. Ninguna falla por falta de red.
- [`src/lib/syncCore.ts`](src/lib/syncCore.ts) — lógica pura y testeada:
  `planOutbox` (FIFO, coalescing, cancelación insert+delete),
  `resolveConditionalUpdate` (LWW), `classifySyncError`, `blockedByParent`,
  `backoffDelayMs`.
- [`src/lib/sync.ts`](src/lib/sync.ts) — el motor: flush del outbox contra
  Supabase, reconciliación por re-fetch, disparadores y Web Locks.
- [`src/components/SyncEngine.tsx`](src/components/SyncEngine.tsx) — lo monta
  con la sesión, una vez, en la raíz.

`items.ts` / `temas.ts` / `recordatorios.ts` quedaron **solo de lectura**: sus
funciones de mutación se borraron para que nadie pueda saltarse el motor.

### Reglas de sincronización

- **Orden:** FIFO por `seq`, que ya respeta las dependencias causales
  (tema → item → recordatorio). Si un item falla, sus recordatorios se saltean
  ese ciclo y se reintentan en el siguiente (FK + RLS los rechazarían).
- **Insert:** `upsert` por el UUID que generó el cliente → reintentar no duplica.
- **Update:** escritura condicional `updated_at <= :clientUpdatedAt`. Si afecta
  0 filas, un `select` de control distingue "el servidor tiene algo más nuevo"
  (descarto mi cambio) de "la fila ya no existe" (gana el borrado y limpio local).
- **Delete:** borrado duro, idempotente.
- **Coalescing:** varias ops de la misma fila se pliegan en una sola escritura.
  `insert` + `delete` sin haber salido nunca a la red se **cancelan** entre sí;
  si el insert ya se había intentado, se manda igual el delete (podría haber
  quedado aplicado con la respuesta perdida).
- **Reconcile:** solo cuando el outbox quedó vacío, re-fetch completo y reemplazo
  del espejo. Nunca al revés: bajar antes de subir pisaría cambios locales.
- **Disparadores:** `online`, foco, `visibilitychange`, intervalo de 30 s,
  arranque, y cada mutación (debounce 200 ms). Single-flight entre pestañas con
  `navigator.locks`. Backoff exponencial 5 s → 5 min tras fallos.

### Indicador de estado (ítem 7)

El motor publica un estado observable —`getSyncState()` / `subscribeSync()`, que
[`useSyncStatus`](src/lib/useSyncStatus.ts) expone a React con
`useSyncExternalStore`— con `online`, `running`, `pending`, `lastSyncAt` y
`error`.

- [`SyncStatus`](src/components/SyncStatus.tsx) en la nav: píldora en mono
  uppercase con punto de color, que **solo aparece cuando hay algo que decir**.
  Sin conexión → slate; error → rust; subiendo la cola → gold con el punto
  latiendo; cambios en cola → gold con el conteo. Con todo al día no dibuja nada.
  `Sincronizando…` sale solo si hay algo que subir, así el re-fetch periódico no
  hace parpadear la barra cada 30 s.
- [`SyncSettings`](src/components/SyncSettings.tsx) en Settings: conexión,
  cambios pendientes, última sincronización ("hace 2 min", desde `meta` de
  IndexedDB) y botón **Sincronizar ahora** que saltea el backoff.
- **Errores:** un fallo aislado de red no molesta (se reporta recién al segundo
  ciclo fallido seguido); el de sesión vencida se muestra desde el primero,
  porque reintentar no lo arregla. `flushOutbox` además distingue las ops
  trabadas por un error permanente y las reporta — antes esas dejaban el
  contador clavado sin explicación, porque el ciclo terminaba sin lanzar.

### Recordatorios sin conexión (ítem 8)

[`useLocalReminderWatcher`](src/lib/useLocalReminderWatcher.ts) sondea el
**espejo local** (`repo.listRecordatoriosParaDisparo()`) en vez de Supabase, así
que **sigue avisando sin conexión** con la app abierta: la notificación es local,
no necesita servidor. El `marcarEnviado` posterior pasa por el repositorio, así
que sin red queda en el outbox y sube al reconectar.

- **Catch-up:** [`splitStaleReminders`](src/lib/reminderScheduling.ts) aparta los
  que vencieron hace más de 2 min (la app estuvo cerrada o el dispositivo
  dormido). En vez de una ráfaga de avisos individuales con fecha vieja,
  disparan **uno solo** — "Tenías N recordatorios vencidos" — y se marcan
  `enviado`. Los que vencen con la app abierta, o cayeron entre dos sondeos,
  siguen avisando normal con el contenido del item.
- Marcarlos `enviado` **no** los esconde: en `/reminders` siguen como **Vencido**
  con el sello *● Notificado* y su botón **Marcar hecho**, porque `clasificar()`
  solo trata como `hecho` los de estado `hecho`.
- **Doble aviso con el cron:** el `enviado` es lo que lo frena, y online sube en
  segundos como antes. Sin conexión queda encolado, así que la ventana en que el
  cron podría reenviar dura lo que dure el corte. Mitigación implementada: el
  cron manda `tag: recordatorio-<id>` y el service worker lo usa (con fallback al
  tag viejo), que es el mismo del aviso local — el push **reemplaza** la
  notificación local en vez de apilar una segunda.

> El `tag` en el payload viaja desde la Edge Function, así que necesitó
> redeploy: `send-reminder-notifications` quedó en **versión 2, `ACTIVE`**
> (desplegada con `--no-verify-jwt --use-api`, como la v1). Guard verificado
> después del deploy: `401 {"error":"No autorizado."}` sin el `x-cron-secret`.

### Asistente sin conexión (ítem 9)

Necesita a Gemini vía Edge Function, así que queda **bloqueado** offline con un
estado explícito: banner con borde rust arriba del chat, input y botón
deshabilitados con placeholder que lo explica, y la guarda de `navigator.onLine`
en el envío como red de seguridad si la señal se cae entre escribir y mandar.
Las acciones que **sí** confirma el usuario pasan por el repositorio, así que un
corte entre proponer y confirmar no pierde el cambio.

### Verificación

- **36/36 tests unitarios** de la lógica pura (`npx deno test src/lib/`): orden
  FIFO y dependencias, coalescing, cancelación insert+delete y el matiz del ack
  perdido, idempotencia al replanificar tras un fallo, los tres desenlaces del
  LWW condicional, clasificación de errores, backoff, el formateo de "hace
  cuánto", y el reparto fresh/stale del catch-up encadenado con el armado de
  timers.
- **Harness de integración en el navegador** (build de producción, temporal):
  29 checks contra IndexedDB real ejercitando `db.ts` + `repo.ts` + `syncCore.ts`
  sin red — crear/editar/borrar deja el espejo y el outbox como corresponde, el
  plan sale en orden causal, el `baseUpdatedAt` y el `updated_at` del update son
  los correctos, y el badge de recordatorios sale del espejo local.
- **Recordatorios offline**: verificado en la app real (build de producción) con
  `navigator.onLine` simulado en `false` y `showNotification` interceptado. Con
  dos recordatorios escritos a mano en el espejo (uno venciendo en 8 s, otro
  vencido hacía 3 h) el watcher disparó exactamente dos avisos: el catch-up
  agregado (`tag: recordatorios-catchup`) y el individual con el contenido del
  item (`tag: recordatorio-<id>`). Ambos quedaron `enviado` en el espejo y
  encolados en el outbox, y `/reminders` los mostró como **Vencido · ●
  Notificado** con su botón **Marcar hecho**.
- **Indicador**: verificado en la app real (build de producción) con una sesión
  de prueba inyectada en el navegador del harness — crear dos items con el
  `navigator.onLine` simulado en `false` deja "Sin conexión · 2 sin sincronizar"
  en la nav y el detalle correspondiente en Settings, y el conteo sobrevive a un
  reload. Los seis estados de la píldora, la sección de Settings y el banner del
  asistente se revisaron con el CSS compilado en desktop y a 375px (colores,
  tipografías, tamaños del punto, sin desbordes horizontales).
- `npm run build` y `npm run lint` sin errores; la app arranca en el preview de
  producción sin errores de consola.
- **Pendiente de tu prueba en vivo** (requiere tu sesión): el ciclo completo
  offline → crear/editar/borrar → online → ver que el contador baja a 0 y que
  los cambios están arriba.

## Rediseño de arquitectura de información — Fases 0 y 1

Primera tanda del rediseño propuesto por Claude Design
([`design_handoff_organizador_ia/`](design_handoff_organizador_ia/)), analizado y
planificado en [`PLAN_REDISEÑO.md`](PLAN_REDISEÑO.md). Son los ítems 1-5 del
plan: **no tocan rutas, ni `AppNav`, ni el asistente** — eso es la Fase 3, que
además está bloqueada por una decisión abierta (¿se conserva `react-router`?).

El sistema "fichas de catálogo" **no se reemplaza, se extiende**: los 10 tokens
de color originales quedan intactos (mismos hex), las 3 fuentes conservan su
reparto de roles y el lomo de 4px por prioridad sigue siendo el elemento central.

### Tokens nuevos y regla de las dos dimensiones (ítem 1)

- Cinco tokens nuevos en el `@theme` de [`src/index.css`](src/index.css):
  `--color-card-2` (segmenteds, header de tabla, zebra), `--color-ink-mute`
  (cuarto nivel de texto), `--color-line-soft` (separadores internos),
  `--color-moss-tint` (superficie activa) y `--shadow-float`.
- **`--shadow-float`, no `--shadow`:** en Tailwind v4 el namespace de utilidades
  de sombra es `--shadow-*`, así que con ese nombre queda además disponible la
  utilidad `shadow-float` para el drawer/sheet/FAB de la Fase 3.
- Por decisión de diseño, la sombra la usa **sólo lo que flota**: en esta fase,
  únicamente la píldora activa del segmented. Las fichas de ítem quedan planas
  con su borde de 1px, como hasta ahora.
- La regla del sistema quedó documentada como comentario de cabecera del
  `@theme`: **prioridad = cálido y va en el lomo; tema = frío y va en el punto;
  nunca mezclar.** Si las dos dimensiones comparten superficie, ninguna se lee.

### Modo oscuro (ítem 2)

- 14 tokens redefinidos bajo `:root[data-theme="dark"]`. Como las utilidades de
  Tailwind resuelven `var(--color-*)` en tiempo de render, **cambia toda la app
  sin variantes `dark:` ni clases duplicadas** — ningún componente sabe qué tema
  está activo.
- [`src/lib/theme.ts`](src/lib/theme.ts): la fuente de verdad es el atributo
  `data-theme` de `<html>`. Persistencia en `localStorage`
  (`organizador:theme`, con `try/catch` por si el storage está bloqueado) y
  suscripción vía `useSyncExternalStore`.
- **Precedencia:** preferencia guardada > `prefers-color-scheme` > claro. Una vez
  que el usuario toca el toggle, su elección manda y no se vuelve a mirar el
  sistema.
- Script inline en [`index.html`](index.html) que corre **antes del primer
  pintado**: sin él, abrir la app en modo oscuro muestra un fogonazo claro hasta
  que monta React.
- Bloque "Apariencia" al tope de [`SettingsPage`](src/pages/SettingsPage.tsx),
  con el segmented Claro/Oscuro.
- Se sacaron los tres colores hardcodeados que quedaban en `index.css` y que
  habrían roto en oscuro: el hover de `.btn-moss` (era `#345035`) y el de
  `.btn-outline` ahora se derivan del token con `color-mix`, y el zebra de
  `.item-table` pasó a `--color-card-2`.
- **Auditoría de contraste WCAG:** la paleta oscura resultó **mejor que la
  clara** — 2 fallos AA contra 6. Los de la clara (`gold`, `slate`) son previos a
  este trabajo y no se tocaron. Detalle y valores propuestos en
  `PLAN_REDISEÑO.md` §8 (decisión D6, abierta).

### Ficha de ítem (ítem 3)

- [`ItemList`](src/components/ItemList.tsx): radius 4px, sin sombra, y la fila de
  metadatos ahora puede mostrar el **recordatorio asociado** (campana + fecha),
  en rust si está vencido. El dato sale de un `Map<item_id, Recordatorio>` que
  arma `ItemsPage` desde la caché local — sin red y sin consulta nueva.
- Un ítem puede tener más de un recordatorio y la ficha muestra uno: se elige el
  más urgente (el pendiente más próximo; si están todos hechos, el más reciente).
- Las acciones Editar/Eliminar pasaron de columna lateral a **pie alineado a la
  derecha**. Eso dejó la ficha igual en desktop y en móvil, así que se pudo
  **eliminar el media query de 480px** de `.item`.

### Recordatorios agrupados (ítem 4)

- [`RemindersPage`](src/pages/RemindersPage.tsx) deja de ser una lista plana:
  segmented **Todos · Vencidos · Próximos · Hechos** y agrupación con hairline en
  **Vencidos · Hoy · Próximos · Hechos**, en ese orden (lo que ya pasó primero).
- `clasificar()` ganó el estado **`hoy`**: pendiente, todavía no vencido y del día
  en curso.
- El filtro "Próximos" incluye `hoy`: separarlos pediría un quinto botón para una
  distinción que ya hacen los grupos.
- Lomo por estado alineado con la escala cálida: **rust** vencido, **gold** hoy y
  próximo (antes próximo era moss), **slate** hecho.

### Biblioteca — filtros y secciones colapsables (ítem 5)

Es el ítem que resuelve el problema que originó el rediseño: la vista de entrada
mostraba toda la lista mezclada, sin separación por tipo ni por tema.

- [`ItemsPage`](src/pages/ItemsPage.tsx): **dos niveles de filtro que se
  combinan** — segmented por tipo (Todos · Notas · Listas · Tablas ·
  **Recordatorios**) y chips por tema, que reemplazan al `<select>`.
- El tipo `recordatorio` existe en el modelo desde el schema inicial y hasta
  ahora no había forma de filtrarlo; la propuesta original lo omitía.
- **Grupo "Sin tema".** `tema_id` es nullable, así que agrupar sólo por los temas
  existentes haría **desaparecer ítems de la vista**. `armarGrupos()` es explícito
  y ordenado: temas primero, después "Sin tema", después "Tema eliminado" para los
  huérfanos (ítems cuyo tema se borró). Ningún ítem puede quedar fuera.
- Secciones **colapsables** con chevron. El estado de plegado vive en `ItemList`
  porque es estado de vista, no del dominio, y no se persiste. La rotación del
  chevron sale de `aria-expanded` vía CSS, así que el estado accesible y el visual
  no pueden desincronizarse.

### Verificación

- `npm run build` sin errores. `npx eslint src` con **0 errores**; los 3 warnings
  que quedan son previos y en archivos que esta fase no tocó (`PushSettings`,
  `AuthContext`, `AssistantPage`).
- **Visual, con el harness de CSS compilado** (no puedo autenticarme): las tres
  pantallas en **desktop 1280px y ~375px, en claro y en oscuro**. Verificado:
  segmented con la píldora activa elevada, chips redondeados con el activo en
  `ink`, encabezados colapsables con chevron (desplegado y plegado), grupo "Sin
  tema", lomos rust/gold/slate, campana + fecha en la ficha, tabla con header
  `card-2` y zebra, y los cuatro grupos de recordatorios con "Vencidos" en rust.
- A 375px: **sin scroll horizontal de página** (`scrollWidth == clientWidth`); el
  segmented de tipos y la fila de chips se llevan su propio scroll (412px de
  contenido en 325px de riel), y las fichas de recordatorio se apilan con la
  acción al final.
- **En la app real** (preview de producción, `AuthPage`): sin nada en
  `localStorage` el script inline resolvió `data-theme="dark"` desde
  `prefers-color-scheme`, y los cinco tokens nuevos resolvieron a sus valores
  oscuros. Sin errores de consola. `AuthPage` heredó el modo oscuro sin tocarla,
  que era una de las dudas abiertas del plan (§3.3-A).
- **Pendiente de tu prueba en vivo** (requiere tu sesión): el toggle de tema con
  recarga, el filtro por tipo incluyendo "Recordatorios", que el grupo "Sin tema"
  aparezca con datos reales, y los recordatorios agrupados con fechas reales.

## Rediseño — Fase 2: color propio por tema

Ítem 6 de [`PLAN_REDISEÑO.md`](PLAN_REDISEÑO.md), la única fase que toca el
modelo de datos. Cierra la segunda dimensión de color del sistema: la
**prioridad** ya vivía en el lomo cálido de la ficha; el **tema** pasa a vivir en
un punto frío. **Nunca comparten superficie** — si lo hicieran, ninguna de las
dos se leería.

### La paleta (7 colores fríos)

- Siete matices en oklch, repartidos cada ~26° entre **verde-agua (168°)** y
  **ciruela (325°)**: verde-agua · turquesa · celeste · azul · índigo · violeta ·
  ciruela. Es el arco que queda **lejos del rust (~40°) y el gold (~75°)** de
  prioridad, y **arranca después del moss de la marca (~150°)** para que un punto
  de tema no se lea como marca.
- Misma L y C en los siete: ningún tema pesa más que otro en la página.
- En modo oscuro suben de 0.55 a 0.72 de luminosidad y bajan un punto de croma —
  sobre el papel oscuro los mismos tonos se apagaban. **Los matices no cambian**,
  así que un tema no "cambia de color" al cambiar de modo.

### Lo que se guarda es el slug, no el color

`temas.color` guarda `'azul'`, no `oklch(...)`. El color sale de los tokens
`--color-tema-*`, que `index.css` redefine en oscuro. Consecuencia práctica: la
paleta se puede retocar en CSS sin migrar una sola fila, y el mismo dato se
resuelve distinto en claro y en oscuro.

### Migración

[`20260723120000_temas_color.sql`](supabase/migrations/20260723120000_temas_color.sql):

- `temas.color text not null default 'azul'` + `CHECK` contra los siete slugs. La
  paleta queda cerrada **en la base**, no solo en el cliente.
- **Backfill que reparte**, no que uniforma: los temas que ya existen reciben la
  paleta rotando por orden de creación dentro de cada usuario, así no salen todos
  del mismo color.
- **`temas.updated_at` + trigger.** Hasta ahora los temas no se editaban desde la
  UI y no hacía falta; con el selector de color sí se editan, y sin columna de
  tiempo el motor de sync **no puede resolver conflictos por LWW** — dos
  dispositivos cambiando el color offline resolvían por orden de llegada. El
  trigger reusa `set_updated_at()`, que ya respeta el timestamp del cliente.
- El backfill de `updated_at` usa `created_at` y no el `now()` de la migración:
  un cambio hecho offline antes de esto no debería perder contra la fecha en que
  se corrió la migración.

### Asignación automática (decisión D4)

[`src/lib/temaColores.ts`](src/lib/temaColores.ts), módulo **puro** (sin
IndexedDB, sin red, sin DOM) y testeado con `deno test` como `syncCore` y
`reminderScheduling`. `siguienteColorTema()` elige en tres pasos:

1. entre los colores **menos usados** — la paleta se reparte pareja en vez de
   amontonarse en los primeros;
2. **descartando el del último tema creado**, que es la repetición que más se
   nota;
3. desempate por **hash del nombre** (FNV-1a): el mismo nombre tiende al mismo
   color en cualquier dispositivo, sin depender del orden de creación.

El default vive en **`repo.createTema()`, no en el form**. Eso es lo que
garantiza que ningún camino de creación deje un tema sin color: ni el formulario,
ni el asistente de IA, ni lo que se agregue después. `createTema` acepta un color
explícito para el caso en que el usuario lo elija a mano.

`colorDeTema()` tolera la fila **sin** color: la caché local puede tener temas
guardados antes de la migración y, hasta la próxima reconciliación, es preferible
un color derivado del id (estable) a un punto gris que parezca un error.

### Dónde se cambia el color, y por qué ahí

No hay pantalla de "gestionar temas" y **no valía la pena inventarla para esto**
(la Fase 3 va a reorganizar la navegación entera; una pantalla nueva ahora sería
trabajo para tirar). Descartado también el selector en el chip de Biblioteca: el
chip es un **control de filtro**, un click ahí ya significa otra cosa, y meterle
un segundo gesto lo vuelve ambiguo.

Quedó en el **`ItemForm`, debajo del `<select>` de tema** — el único lugar donde
el tema ya está en pantalla y seleccionado:

- con un tema existente elegido → muestra su color actual y **cambiarlo guarda al
  instante** (es propiedad del tema, no del ítem: atarlo al submit del formulario
  sería mentir sobre qué se está editando);
- con "+ crear tema nuevo" → muestra el color **propuesto automáticamente**, que
  se puede cambiar antes de crear. D4 completa —automático con opción de
  cambiarlo— en un solo control.
- La nota al pie dice de cuál de los dos casos se trata, incluyendo el nombre del
  tema, para que nadie crea que está pintando el ítem.

### Offline-first

El cambio de color **no toca Supabase directo**: pasa por
`repo.updateTemaColor()`, que escribe el espejo local y encola la op, igual que
todo lo demás. Sin conexión el punto cambia al instante y la escritura sube
cuando haya red. El `updated_at` viaja en el payload, así que el motor aplica la
**guarda LWW** (`.lte('updated_at', …)`) y no pisa un cambio más nuevo hecho en
otro dispositivo.

Efecto lateral bueno: como la asignación automática lee el espejo local —donde el
tema recién creado ya está—, dos temas creados en la **misma tanda de acciones
del asistente** tampoco salen iguales.

### Dónde se ve el punto

- **Chips de tema** en Biblioteca ([`ItemsPage`](src/pages/ItemsPage.tsx)). Sobre
  el chip activo (fondo `ink` sólido) el punto lleva un aro del color del fondo
  para despegarlo del borde.
- **Encabezados de grupo colapsables** ([`ItemList`](src/components/ItemList.tsx)),
  a 10px para acompañar al Fraunces de 19px.
- **No** en "Sin tema" ni en "Tema eliminado": no son temas, y un color ahí
  prometería algo que no existe.
- Las tarjetas de tema de la vista **Hoy** son el tercer lugar previsto en el
  plan; esa vista es de la Fase 3 y todavía no existe.

### Verificación

- `npm run build` sin errores. `npm run lint` con **0 errores** (los 3 warnings
  son previos y de archivos que esta fase no tocó).
- `npx deno test src/lib/` → **47 tests OK**, 11 de ellos nuevos para la
  asignación de color: que reparte la paleta entera antes de repetir, que no
  repite el color del último tema creado, que el "último" se decide por
  `created_at` y no por el orden del array, que el mismo nombre cae siempre en el
  mismo color, y que ignora valores fuera de la paleta.
- **Visual, con el harness de CSS compilado** (no puedo autenticarme): chips con
  punto (activo e inactivo), encabezados de grupo con y sin punto, y el selector
  de siete muestras con el aro del activo, en **desktop y 375px, claro y
  oscuro**. Sin errores de consola. A 375px las siete muestras entran en una fila
  y la fila de chips se lleva su propio scroll.
- Ajuste hecho **a partir de mirarlo**: el verde-agua y el turquesa originales
  (178°/200°) se confundían entre sí a 9px; se abrieron a 168°/196°.
- La app real carga sin errores de consola hasta el `AuthPage`.
- **Pendiente de tu prueba en vivo** (requiere tu sesión y la migración
  aplicada): que los temas que ya tenés salgan con colores distintos entre sí;
  crear dos temas seguidos y ver que no repiten color; cambiar el color de uno
  desde el form y ver que cambia en los chips y en los encabezados; y el ciclo
  offline — cambiar un color sin conexión, ver el contador de pendientes subir,
  volver online y confirmar que el color quedó arriba.
- **⚠️ Orden de despliegue:** la migración va **antes** que el frontend. Con la
  columna todavía sin crear, el insert de un tema nuevo falla en el servidor con
  error permanente y la op se queda trabada en el outbox.

## Rediseño — Fase 4: captura de item por foto (ítem 14)

Cierra una de las cuatro funciones pendientes del brief de diseño: sacarle una
foto a algo del mundo real —una lista escrita a mano, un recibo, una tabla, un
cartel— y que la app proponga un item ya estructurado.

Es la única de las cuatro que necesitaba **backend nuevo de punta a punta**.

### La foto no se guarda en ningún lado

La decisión de fondo, y la que ordena todo el resto: **la imagen es un medio, no
un dato**. No pasa por Supabase Storage, no se escribe en IndexedDB, no entra al
outbox y no queda en un log. Se lee del `<input type="file">`, se achica en
memoria, se manda a la Edge Function, se reenvía a Gemini y se descarta al
terminar el request.

Lo único que persiste es el item que el usuario confirmó — exactamente el mismo
que si lo hubiera escrito a mano, con `items.origen = 'foto'` como única marca de
por dónde entró. La columna existe desde el schema inicial justamente para esto.

Consecuencia práctica: la función no agrega superficie de datos nueva. No hay
cuota de storage que administrar, ni borrado de binarios, ni sincronización de
archivos en una app que hoy sincroniza sólo texto.

Y se lo dice en la pantalla donde se está por sacar la foto, no en letra chica en
otro lado: *"La imagen se usa sólo para leerla y se descarta — no se guarda en tu
cuenta."*

### Edge Function `extract-from-photo`

Mismo patrón de seguridad y de errores que `ai-assistant`:

- JWT de usuario válido + `ai_enabled` con key guardada, o no hace nada.
- La key se descifra en la función (AES-256-GCM, mismo mecanismo), nunca se
  persiste ni vuelve al cliente. Se descifra **después** de validar el body: si
  la imagen viene mal, ni se toca.
- **No escribe nada.** Sólo propone. El item lo crea el frontend por `repo.ts`
  cuando el usuario confirma, así que la escritura es offline-first como el resto.

**Modelo: `gemini-2.5-flash`, el mismo que el asistente.** No hace falta un modelo
aparte para visión — 2.5-flash es nativamente multimodal y acepta texto e imagen
en el mismo `contents`; lo único que cambia es una part `inlineData` extra. Que
sea el mismo importa: una sola cuota, un solo modelo que actualizar el día que
Google retire este (ya pasó con `gemini-2.0-flash`).

**La foto consume la misma cuota diaria que el chat.** Comparte el pre-flight de
cuota aprendida (si ya sabemos que hoy se agotó, se corta sin mandar la imagen a
ningún lado), el manejo adaptativo del 429 con `quotaValue`/`retryDelay` reales, y
los mensajes en español ya existentes de `translateGeminiError`. No se inventó
ningún texto nuevo para casos que el server ya sabía explicar.

Diferencias con el asistente, y por qué:

| | `ai-assistant` | `extract-from-photo` |
|---|---|---|
| Turnos | hasta 5 (function-calling) | **1** — la imagen entra, sale una propuesta |
| Tools | 5 declaradas | ninguna |
| Salida | texto + `functionCall` | JSON con `responseSchema` |
| `maxOutputTokens` | 2048 | **4096** — transcribir una tabla entera es largo |
| Acciones | N, de los 3 tipos | **1**, siempre `create` |

`thinkingBudget: 0` en las dos, por el mismo motivo de siempre.

### La propuesta tiene la misma forma que la del asistente

`extract-from-photo` devuelve una `AccionCrear` idéntica a la que emite
`proposeCreateItem`. No es cosmético: es lo que permite reusar **la misma tarjeta
de preview**, que se mudó de adentro de `AssistantDrawer` a
`src/components/ProposedActionCard.tsx`.

El principio de "la IA nunca escribe sin confirmación" se sostiene mejor con un
solo preview que los dos caminos comparten que con dos tarjetas parecidas que se
van separando con el tiempo. Lo mismo con el guardado: el "cómo se convierte una
acción propuesta en un item" vive ahora en `src/lib/accionesPropuestas.ts`, y el
drawer pasó a llamarlo en vez de tener su copia.

Único agregado al tipo: `columnas` / `filas` opcionales para el tipo `tabla`. La
foto es el primer camino que puede detectar una tabla de verdad, y mostrarla
**como tabla** en el preview es lo que hace que confirmar signifique algo — con el
texto con pipes suelto no se ve si las columnas quedaron alineadas. El preview usa
las mismas clases (`.item-table-wrap` / `.item-table`) con que `ItemList` dibuja
una tabla guardada, así que se ve igual antes y después de guardar.

### Estructurado en el preview, pipes al guardar

Decisión que vale explicitar porque parece una inconsistencia y no lo es: la tabla
se **propone** como `{columnas, filas}` pero se **guarda** como texto con pipes.

`ItemList` sabe renderizar las dos formas, así que guardarla estructurada sería
tentador. El problema es `ItemForm`: el editor de grilla es el **ítem 12** y
todavía no existe. Una tabla guardada como jsonb abriría el textarea con el JSON
crudo adentro y guardarla desde ahí la destrozaría. Con pipes, una tabla que salió
de una foto se edita después igual que cualquier otra.

Cuando llegue el ítem 12, `tablaATexto` en `accionesPropuestas.ts` es el único
punto que hay que cambiar.

### Cuando el modelo se contradice, mandan los datos

`normalizarExtraccion` no confía en la etiqueta que eligió Gemini: si dice
"tabla" pero no mandó filas, y sí mandó líneas, es una lista; si dijo "nota" pero
mandó filas, es una tabla. Es preferible guardar bien lo que se leyó que respetar
un tipo que quedó huérfano de contenido.

Si no queda **nada** aprovechable (ni texto, ni líneas, ni filas) devuelve `null`,
y eso es lo que dispara el mensaje de "no pude interpretar la foto" en vez de
proponer un item vacío.

Detalle chico que importa en un recibo: una celda vacía se conserva (perderla
desalinearía la fila entera); lo que se descarta es la fila entera vacía.

### Frontend: el modo foto del sheet

"Desde una foto" era la opción 2 del menú de `NuevoItemSheet`, visible pero
apagada desde el ítem 11. Ahora funciona.

- `<input type="file" accept="image/*" capture="environment">` — en el teléfono
  abre la cámara trasera; en desktop el atributo se ignora y queda el selector de
  archivos. El input no se ve nunca: lo dispara el botón.
- **La foto se achica antes de mandarla**: lado mayor a 1600px, JPEG q0.82, con un
  canvas. Importa por tres motivos a la vez — el body de una Edge Function tiene
  tope, base64 infla un 33%, y Gemini cobra la imagen por tokens. A 1600px un
  recibo o una lista a mano se siguen leyendo bien. Si el navegador no puede
  redimensionar, se manda el original: mejor una foto grande que una función que
  no anda.
- Máquina de estados chica y explícita —`elegir → listo → analizando → propuesta →
  corrigiendo → editando`— porque el paso de "analizando" a "propuesta" es justo donde la app
  promete que todavía no guardó nada, y con banderas sueltas ese punto se difumina.
- **Editar antes de guardar**: la propuesta se abre en el `ItemForm` de siempre
  con los campos ya cargados, vía un `borrador` que el form trata como creación
  (no tiene id, no existe en ningún lado). Cancelar desde ahí no deja rastro. El
  `origen` sigue siendo `'foto'` aunque el usuario corrija todo: lo que la columna
  registra es de dónde salió el contenido, no quién lo tocó último.
- **Cancelar vuelve a "elegir foto", no cierra el sheet**: lo más probable después
  de "no, esto no es lo que quería" es sacar otra foto, no empezar de cero.

### Precisión: comentario antes, corrección después

La primera versión leía la foto y no había más que hacer: si Gemini se saltaba un
renglón o le erraba al tema, la única salida era corregirlo a mano en el form —o
sea, transcribirlo uno mismo, que es justo lo que la función venía a evitar. Se
sumaron dos vías, una a cada lado de la lectura, y un arreglo del prompt.

**El prompt perdía datos en silencio.** La regla decía *"si algo está borroso o
cortado, omitilo"*. La intención era no alucinar; el efecto era que lo dudoso
desaparecía sin que el usuario se enterara. Ahora lo dudoso **se marca, no se
borra**: se transcribe lo que se alcance a leer con un `[?]` al lado (o `[?]` sola
si la celda no se lee, para no correr la fila), y si algo quedó ilegible o la foto
parece cortada, tiene que decirlo en el `resumen`. El usuario puede corregir lo
que ve; no lo que no está.

**El razonamiento estaba apagado.** `thinkingBudget: 0` venía de que 2.5-flash
puede gastar el presupuesto entero antes de emitir `parts`. Pero transcribir una
tabla larga sin saltear renglones ni correr una columna es justamente donde el
razonamiento sirve, así que ahora hay presupuesto **acotado** (2048, no `-1`
dinámico) y `maxOutputTokens` sube a 8192 en consecuencia: en 2.5 los tokens de
pensamiento salen del mismo tope que la salida, y dejarlo en 4096 habría dejado la
transcripción con menos aire que antes.

**Comentario antes de analizar.** Elegir la foto ya no dispara el análisis: cae en
la fase `listo`, con la miniatura y un campo opcional ("es un recibo, ignorá el
total"). Entra al prompt como bloque aparte, marcado como dicho por el usuario y
con instrucción explícita de hacerle caso a él cuando contradice las reglas
generales — si no, "transcribí todo lo que se lee" le gana a "ignorá el total".

**Corrección después del resultado.** En la tarjeta de preview, al lado de "editar
antes de guardar", hay un "esto no está bien" que abre un campo para explicar qué
falta o qué está mal. Se reenvía la **misma foto** —que el sheet conserva en
memoria, sin persistirla en ningún lado— junto con la propuesta anterior y el
texto del usuario, y se le pide que **ajuste** esa propuesta, no que la rehaga:
*"ajustá lo que el usuario señala; todo lo demás dejalo igual"*, que es lo que
evita que una corrección chica vuelva con media tabla reordenada. La propuesta
corregida cae en la misma tarjeta y **se puede corregir de nuevo**, sin tope.

Corregir ≠ editar, y por eso conviven: editar abre el `ItemForm` y lo arregla a
mano; corregir se lo devuelve a Gemini con la foto, que es lo que sirve cuando
falta algo que **está en la imagen** y escribirlo a mano sería transcribirlo uno
mismo.

Cada corrección es una llamada más y gasta cuota. No se advierte con un cartel:
se dice una vez donde se decide ("usa un mensaje de IA") y se muestra el contador
de cuántas van, con el mismo tono y alineación que el contador de cuota que ya
vivía al pie. Un número que se acumula invisible es peor que uno a la vista.

Los dos textos son un solo endpoint y un solo modo de fallar: `extract-from-photo`
recibe `comentario`, `propuesta_anterior` y `correccion` opcionales, y una
corrección no es más que otra lectura de la misma foto con más contexto — misma
cuota, mismo rate limit, mismo saneado, mismos mensajes en español. La propuesta
anterior vuelve del cliente, así que **no se confía tal cual**: se pasa por el
mismo `normalizarExtraccion` que sanea lo que devuelve Gemini antes de entrar al
prompt. Si el texto de corrección llega sin propuesta reconocible, se degrada a
una lectura inicial en vez de tirar un 400 con la foto ya subida.

**Un hueco que se tapó de paso.** El guard de `candidate sin parts` cubría el
corte limpio (Gemini no llegó a emitir nada, `finishReason` explica por qué), pero
no el corte sucio: emitir `parts` con el JSON cortado a la mitad. Ahí el parseo
falla y el usuario recibía *"no pude interpretar la foto — sacala con mejor luz"*,
que lo manda a arreglar algo que no está roto. Ahora, si el motivo real es
`MAX_TOKENS`, se lo dice.

### Offline y IA apagada

La opción queda deshabilitada cuando `!online || aiEnabled === false`, y —mismo
criterio de siempre— **dice por qué**, en el `title` y en la propia descripción de
la opción, en vez de esconderla o dejarla muerta:

- sin red → *"No hay conexión — leer una foto no está disponible ahora mismo."*
- IA apagada → *"Activá la IA en Ajustes para leer items desde una foto"*

Con red de seguridad en `handleFoto`: si la señal se cae entre que se abrió el
modo foto y se eligió la imagen, se corta ahí en vez de mandar la llamada y
mostrar un error de red genérico. Es el mismo patrón que `handleSend` del
asistente.

Una asimetría deliberada: la **lectura** necesita red (es Gemini), pero la
**escritura** al confirmar no — pasa por `repo.ts`, así que si la conexión se cae
entre la propuesta y el confirmar, el item se guarda local y sube después.

### Verificación

- `npm run build` sin errores. `npm run lint` con **0 errores** (los 2 warnings
  son previos, de `PushSettings.tsx` y `AuthContext.tsx`, que esta fase no tocó).
- `npx deno test supabase/functions/` → **30 tests OK**, 22 nuevos para la lógica
  pura de la extracción: parseo del JSON (pelado, en bloque markdown, embebido
  entre texto, basura), las cinco reglas de coherencia tipo↔datos, celdas vacías
  que no desalinean, tipo y prioridad inválidos, y el caso "no se pudo leer" que
  devuelve `null`.
- **Visual, con el harness de CSS compilado** (no puedo autenticarme): las siete
  pantallas del flujo —menú con la foto activa, menú sin conexión, elegir foto,
  error de lectura, propuesta de tabla, propuesta de lista, analizando— en
  **desktop y 375px, claro y oscuro**. Sin desborde horizontal a 375px
  (`scrollWidth === innerWidth`) y la tabla del preview entra sin necesitar su
  scroll propio. Sin errores de consola; la app real carga limpia hasta `AuthPage`.
- Ajuste hecho **a partir de mirarlo**: `.foto-modo` arrancó con
  `align-items: flex-start` y eso encogía la tarjeta de preview al ancho de su
  contenido. Ahora estiran todos los hijos y sólo los botones se achican — un
  botón estirado a 540px se lee como una barra, no como una acción.
- **Desplegada al proyecto real** (`extract-from-photo`, versión 1, `ACTIVE`,
  `verify_jwt: true`). No hizo falta ningún secret nuevo: reusa
  `AI_KEY_ENCRYPTION_SECRET`, `SUPABASE_URL` y `SUPABASE_ANON_KEY`, que ya
  estaban para `ai-assistant`. Smoke test contra la función viva, sin gastar
  cuota de Gemini: sin header → `401 UNAUTHORIZED_NO_AUTH_HEADER` (gate de
  plataforma); `OPTIONS` → `200 ok` (el preflight de CORS propio); con la anon
  key → `401 {"error":"Sesión inválida o expirada."}`, que es el handler propio
  corriendo y rechazando un JWT que no es de usuario.
- **Pendiente de tu prueba en vivo** (requiere tu sesión y tu key de Gemini, que
  la función descifra): sacar/subir una foto real de un recibo, una lista escrita
  a mano y una tabla, y confirmar que la extracción y el preview funcionan.
- **⚠️ Orden de despliegue:** la Edge Function va **antes** que el frontend. Con
  la función sin desplegar, "Desde una foto" se ve habilitada y falla al invocar.
  Se respetó: la función quedó `ACTIVE` antes de integrar el frontend a `master`.

## Recuperar contraseña por correo

Hasta acá, olvidarse la contraseña era una puerta cerrada: la única salida era
crear otra cuenta. Supabase Auth ya trae las dos mitades del flujo
(`resetPasswordForEmail` manda el correo, `updateUser` guarda la contraseña
nueva), así que esto es frontend y configuración — sin tabla, sin migración y
sin Edge Function.

### El router tuvo que darse vuelta

El cambio menos visible y el que más importa. `ProtectedRoute` envolvía al
`BrowserRouter` entero, así que **sin sesión no había router**: cualquier URL
mostraba el login. Eso alcanzaba mientras todas las pantallas fueran privadas,
pero `/reset-password` es justo la que abre alguien que **no puede** iniciar
sesión — es la razón por la que está pidiendo el link.

Ahora el router es lo de afuera y la puerta bajó un nivel, a un layout route
(`RutasPrivadas`) que envuelve al resto:

```
BrowserRouter
├── /reset-password        ← pública
└── RutasPrivadas          ← ProtectedRoute + SyncEngine + LocalReminderWatcher
    ├── AppShell
    │   ├── / (Hoy), /biblioteca, /reminders, /assistant, /settings
    └── *  → redirige a /
```

El motor de sync y el watcher quedaron en ese layout y no en el shell: sólo
tienen sentido con sesión, y como los layout routes no se desmontan al navegar,
se siguen montando una sola vez (que era la razón de estar donde estaban).

El comodín `*` es nuevo y tapa un agujero previo: antes una URL desconocida
mostraba el login (sin sesión) o una pantalla en blanco (con sesión), porque el
`<Routes>` no matcheaba nada. Ahora cae en Hoy.

### Pedir el link — no se dice si el correo existe

El link "¿Olvidaste tu contraseña?" no abre otra pantalla: agrega un tercer modo
(`recuperar`) al formulario que ya tenía login y alta. Los tres piden email y
sólo dos piden contraseña; separarlos habría duplicado el campo, su validación
y el manejo de error/info.

La respuesta es **siempre la misma**, exista o no la cuenta:

> Si el correo existe, te enviamos un link para restablecer tu contraseña.
> Revisá tu bandeja de entrada y la carpeta de spam.

Es deliberado: si el mensaje cambiara según el caso, la pantalla serviría para
averiguar **quién tiene cuenta acá** sin necesidad de ninguna contraseña. El
único error que sí se muestra es el **429** (límite de envíos), que no dice nada
de la cuenta y explica por qué no llegó el correo.

`redirectTo` se arma como `` `${window.location.origin}/reset-password` ``, no
como una URL fija: el mismo build corre en `localhost`, en Render y en la PWA
instalada. Quien decide qué orígenes son aceptables es Supabase, con su lista de
Redirect URLs (ver abajo).

### `/reset-password` — esperar la sesión, no asumirla

El link del correo cae en la ruta con el token en la URL y **supabase-js lo
canjea solo** (`detectSessionInUrl`, activo por defecto). Eso es asincrónico: en
el primer render puede no haber sesión todavía. La pantalla tiene cuatro
estados y arranca en el de espera:

| Estado | Cuándo | Qué se ve |
| --- | --- | --- |
| `verificando` | al entrar | "Validando el link…" |
| `listo` | apareció la sesión de recuperación | las dos contraseñas |
| `invalido` | error en la URL, o 5 s sin sesión | por qué falló + volver al inicio |
| `guardado` | `updateUser` OK | confirmación y salto a Hoy |

La sesión se espera por **dos caminos a la vez** —`getSession()` y el evento de
`onAuthStateChange`— porque cuál gana depende de si supabase-js ya terminó de
leer la URL o no. El timeout de 5 s es el que decide que el link no servía: sin
él, un link vencido dejaba la pantalla en "Validando…" para siempre (el mismo
patrón de `await` colgado que ya nos mordió con `getSession` en `AuthContext` y
con `serviceWorker.ready` en `push.ts`).

Los rechazos del link **no vuelven como error de una llamada**: Supabase los
manda en la propia URL, en el hash (flujo implícito) o en la query (PKCE). Por
eso se leen los dos. `otp_expired` tiene mensaje propio —el caso corriente— y
menciona que los links son de un solo uso, porque "ya lo usé" y "se venció"
terminan en el mismo lugar y el usuario tiene que saber que la salida es pedir
otro.

Las dos validaciones locales (largo y coincidencia) van **antes** de la llamada:
no tiene sentido gastar un viaje al servidor para que rebote algo que ya se ve
acá. Los mensajes de Supabase que sí pueden aparecer se traducen (contraseña
corta, contraseña igual a la anterior, sesión vencida, 429); el resto cae a un
genérico que **muestra el texto original detrás**, para no esconder un problema
real.

Al guardar, el usuario ya tiene sesión (el link se la dio), así que va a **Hoy**
y no al login, con `replace` para que "atrás" no vuelva a la URL con el token.

### Diseño

Las tres pantallas de sesión comparten `AuthCard` (`src/components/AuthCard.tsx`):
misma tarjeta centrada, marca en Fraunces, rótulos en Plex Mono, campos `.ctl` y
botón `.btn-moss`. Está factorizado y no copiado porque son **la misma pantalla
con distinto contenido**: si el chasis se duplicara, la de restablecer —que se ve
una vez cada tanto, y por eso nadie mira— sería la primera en quedar desalineada
del login. Los mensajes usan el código de color de siempre: rust lo que falló,
moss lo que salió bien.

En login las salidas son dos (crear cuenta, recuperar) y van **apiladas**: en
una fila competirían por el mismo lugar; en columna se leen como dos caminos
distintos.

### Verificación

- `npm run build` sin errores. `npm run lint` con **0 errores** (siguen los 2
  warnings previos de `PushSettings.tsx` y `AuthContext.tsx`).
- **En el navegador, contra el dev server, sin tocar la sesión real:** el truco
  fue usar `http://[::1]:5173` como segundo origen — Vite escucha ahí igual, y
  para el navegador es **otro origen**, así que tiene su propio `localStorage` y
  entra sin sesión. Así se pudo ver el login sin desloguear la sesión de
  `localhost`.
- Pantallas verificadas en **claro y oscuro, desktop y 375 px**, sin desborde
  horizontal (`scrollWidth === innerWidth`) y sin errores de consola: login con
  las dos salidas, modo recuperar, confirmación de envío, formulario de
  contraseña nueva, "las contraseñas no coinciden", link vencido
  (`#error_code=otp_expired`) y el timeout de validación.
- **El pedido de link salió de verdad:** la llamada fue a
  `/auth/v1/recover?redirect_to=…%2Freset-password`, con el origen correcto.
  Se probó con una dirección `@example.com` **que no es usuario** — Supabase no
  manda correo en ese caso, así que no se gastó cuota del SMTP integrado, y la
  UI igual respondió con el mensaje que no revela nada.
- **La contraseña de la cuenta real nunca se tocó:** el error de coincidencia se
  probó sobre la sesión viva y se confirmó por `performance.getEntriesByType`
  que **no hubo ninguna llamada a Supabase** — las validaciones locales cortan
  antes de `updateUser`.
- **Sin regresión en lo privado:** Hoy, Biblioteca y Ajustes siguen andando con
  el shell montado, y `/ruta-que-no-existe` ahora redirige a `/`.
- **Pendiente de tu prueba en vivo** (requiere tu casilla): pedir el link a tu
  correo real, abrirlo y cambiar la contraseña de punta a punta. Esa parte no la
  puedo hacer yo — ver abajo.

### Lo que tenés que hacer vos en Supabase (no lo puedo hacer yo)

Todo esto es en <https://supabase.com/dashboard> → tu proyecto →
**Authentication**. Sin el punto 1, el link del correo **no va a funcionar**:
Supabase se niega a redirigir a un origen que no esté en su lista.

1. **Authentication → URL Configuration:**
   - **Site URL:** `https://organizador-ia.onrender.com` (tu dominio de Render;
     si le pusiste otro nombre, ese). Es el destino por defecto cuando un link
     no trae `redirect_to` válido.
   - **Redirect URLs:** agregá estas dos entradas —
     - `https://organizador-ia.onrender.com/reset-password`
     - `http://localhost:5173/reset-password` (para probar en tu máquina; podés
       borrarla después)

     También sirve `https://organizador-ia.onrender.com/**` si preferís habilitar
     todas las rutas del dominio de una. Guardá con **Save**.
2. **Correo: el SMTP integrado alcanza para que lo pruebes VOS, y para nadie
   más.** El servicio gratis que trae Supabase tiene dos límites duros, los dos
   documentados por ellos: **~2 mensajes por hora**, y **sólo entrega a
   direcciones que sean miembros del equipo/organización del proyecto** —
   cualquier otra la rechaza. Como el proyecto es tuyo, a tu casilla te va a
   llegar; a la de un tercero **no**. Supabase dice explícito que el SMTP por
   defecto es para explorar y probar plantillas, no para producción.

   Conclusión: si la app va a ser sólo tuya, **no tenés que configurar nada
   más**. En cuanto haya un segundo usuario, "recuperar contraseña" no le va a
   funcionar hasta que pongas **SMTP propio** en **Authentication → Emails →
   SMTP Settings** (Resend, Brevo, SendGrid, Mailgun o similar: creás la cuenta,
   verificás el dominio y pegás host, puerto, usuario y contraseña). Eso no lo
   puedo hacer yo: requiere tu cuenta en el proveedor.
3. **Opcional — el texto del correo:** **Authentication → Emails → Templates →
   Reset Password**. Llega en inglés por defecto; si querés, traducilo. Lo único
   que **no** hay que tocar es la variable `{{ .ConfirmationURL }}`, que es el
   link.
4. **Probalo de punta a punta:** entrá al login, "¿Olvidaste tu contraseña?",
   poné tu correo, abrí el link que te llega y cambiá la contraseña. Ojo con dos
   cosas: el link **se usa una sola vez** y **vence** (el plazo se ve y se
   cambia en **Authentication → Sign In / Providers → Email → Email OTP
   expiration**; los proyectos nuevos vienen en 1 hora), y conviene abrirlo
   **en el mismo navegador** desde donde lo pediste.

## Recordatorios recurrentes

Hasta acá un recordatorio era de **una sola vez**: se disparaba (o lo marcaban
hecho) y quedaba así para siempre. Ahora puede repetirse **diario / semanal /
mensual / días específicos** (ej. lunes, miércoles y viernes). Sin fecha de fin
en esta versión: para cortarlo, el usuario edita el item y elige "No se repite",
o borra el item.

### Datos

`recordatorios.recurrencia` (`text`, nullable, check en `'diario' | 'semanal' |
'mensual' | 'dias_semana'`). `null` = no se repite, que es exactamente lo que
tienen todas las filas que ya existían — no hizo falta backfill ni cambió nada
para lo ya creado.

`recordatorios.recurrencia_dias` (`smallint[]`, nullable) guarda **qué** días,
sólo para `'dias_semana'`. Dos checks lo sostienen: los valores están entre 0 y
6 sin repetidos (1 a 7 días), y los días existen **si y sólo si** la recurrencia
es `'dias_semana'` — sin eso podrían quedar días huérfanos de un recordatorio
que pasó a diario, o un `dias_semana` sin días, que no se puede calcular.

> **Convención de `recurrencia_dias`** — es la parte sutil. Enteros 0-6 con
> **0 = domingo**, la escala de `getUTCDay()`, y por lo tanto días de la semana
> **en UTC**, no en la zona del usuario. No es un capricho: toda la aritmética
> de fechas es en UTC (ver abajo), así que los días tienen que estar en la misma
> escala para poder compararse contra `getUTCDay()` sin conversión.
>
> En Argentina (UTC-3) los dos coinciden casi todo el día, pero **no de 21:00 a
> 23:59**, que ya son el día siguiente en UTC. Un "los lunes a las 22" se guarda
> como martes 01:00 UTC con `recurrencia_dias = {2}`, y la app lo vuelve a
> mostrar como "lunes". Esa traducción la hace **sólo el cliente**
> (`diasLocalesAUtc` / `diasUtcALocales`), que es el único que conoce la zona; el
> servidor nunca la necesita.
>
> **Invariante:** el día UTC de `fecha_hora` siempre está en `recurrencia_dias`.
> Lo mantiene `ajustarADiaMarcado`, que engancha la primera fecha al próximo día
> marcado.

### `semanal` y `dias_semana` no son lo mismo

`semanal` suma 7 días desde la última vez, así que cae siempre en el mismo día.
`dias_semana` avanza al próximo día marcado. Con **un solo día** marcado los dos
dan exactamente lo mismo, y con **los siete**, `dias_semana` equivale a
`diario`; las dos continuidades están fijadas con tests. Es deliberado: no hay
combinación de días que se comporte de forma rara.

**No hay filas nuevas por vuelta.** Un recordatorio recurrente es siempre la
misma fila: cuando se cumple, se le adelanta `fecha_hora` y vuelve a
`'pendiente'`. Así el item conserva su único recordatorio, el historial no crece
sin control y el outbox no tiene que ordenar inserts contra updates.

### La lógica vive DOS veces, a propósito

`src/lib/recurrencia.ts` y
`supabase/functions/send-reminder-notifications/recurrencia.ts` son gemelos
exactos. No comparten código porque corren en runtimes que no se pueden importar
entre sí (el bundle de Vite en el navegador vs. Deno en el Edge), y el **mismo**
recordatorio puede avanzar por cualquiera de los dos caminos:

- el **cliente**, cuando dispara el aviso local o el usuario marca "hecho";
- el **cron del servidor**, cuando manda el push.

Si divergieran, el mismo recordatorio caería en fechas distintas según quién lo
movió — un bug imposible de reproducir a mano. Por eso la paridad no se confía a
la disciplina: hay un test
(`send-reminder-notifications/recurrencia.test.ts`) que **importa las dos
copias** y compara sus salidas sobre un barrido de fechas. Si alguien toca una
sola, falla.

### Las dos decisiones de fechas

**1. Todo en UTC.** El cliente corre en la zona del usuario y el Edge corre en
UTC. Si un lado usara los setters locales y el otro los UTC, las dos mitades
darían resultados distintos justo en los bordes de horario de verano. Haciendo
todo en UTC en los dos lados, el resultado es idéntico venga de donde venga. La
contra: en una zona **con** DST, un "todos los días a las 9" pasaría a las 8 o a
las 10 al cruzar el cambio de hora. Para Argentina (UTC-3 todo el año) no hay
diferencia.

**2. El mensual recorta, y el recorte no se recuerda.** El 31 de enero + 1 mes
no existe: se recorta al último día del mes destino (31/01 → 28/02, o 29/02 en
bisiesto). Como la vuelta siguiente sale de la fecha ya recortada, un mensual del
31 **se corre al 28** al pasar por febrero y ahí se queda (28/02 → 28/03 →
28/04…) en vez de volver al 31.

> **Limitación conocida.** Para que volviera al 31 haría falta guardar el día
> ancla original en una columna aparte, que esta versión no tiene. Está cubierto
> por un test que lo fija como comportamiento esperado, no como accidente.

**3. El atrasado reengancha, no se acumula.** `proximaOcurrencia` no suma una
vuelta: avanza hasta pasar el ahora. Si un "todos los días a las 9" estuvo cinco
días sin dispararse (app cerrada, sin señal, cron caído), sumar un día lo dejaría
todavía vencido y volvería a disparar **una vez por ciclo** hasta alcanzar el
presente. Avanzando hasta el futuro, engancha directo en su próxima vuelta real.

**4. `dias_semana` avanza de a un día, nunca cero.** Entre 1 y 7 saltos hasta
caer en el próximo día marcado. El "nunca cero" es lo que importa: si pudiera
quedarse en el día actual, un lunes marcado se clavaría en ese lunes para
siempre. El caso que lo prueba es el del enunciado — hoy **es** un día marcado
pero la hora ya pasó: tiene que irse al próximo marcado, no quedar vencido.

**5. Guarda anti-bucle.** Si el cálculo **no avanza** (un `dias_semana` cuyos
días quedaron vacíos o corruptos, una fecha ilegible), volver a `'pendiente'` con
la misma fecha vencida dejaría el recordatorio disparando una vez por ciclo para
siempre. En ese caso se cierra como uno de una sola vez. Está en los dos lados,
`repo.ts` y la Edge Function, con el mismo criterio.

### Offline-first, sin nada especial

`marcarHecho` / `marcarEnviado` calculan la fecha nueva **localmente** y encolan
un update común y corriente por el mismo camino que cualquier otra mutación
(espejo local en IndexedDB + outbox). Marcar hecho un recurrente sin conexión
avanza la fecha al instante en la UI y sube sola al reconectar.

Un detalle que sí hizo falta: el watcher local lleva un set de ids "ya
disparados en esta pestaña" para no notificar dos veces. Un recurrente que
reengancha vuelve a `'pendiente'`, así que hay que **sacarlo de ese set** — si
no, el supresor le impediría armar el timer del ciclo siguiente y un "todos los
días a las 9" avisaría una sola vez hasta recargar la página. Por eso
`marcarEnviado` ahora devuelve la fila resultante en vez de `void`.

### UI

- **ItemForm:** selector "No se repite / Diario / Semanal / Mensual / Días
  específicos" al lado del campo de fecha/hora (`.rec-campos`, que los apila en
  pantalla angosta). Son una sola decisión —"cuándo y cada cuánto"—, separarlos
  dejaría el selector lejos del campo del que depende.
- **Con "Diario" y "Días específicos" no se pide fecha.** El campo cambia a un
  `<input type="time">` (sólo hora) y el de fecha desaparece. La razón es que ahí
  la fecha no aporta nada: "diario" es todos los días y "días específicos" ya
  trae sus días, así que lo único que el usuario decide es la HORA. Con "Semanal"
  y "Mensual" el `datetime-local` se queda, porque ahí la fecha **sí** es la que
  fija qué día de la semana o del mes se repite.
- La `fecha_hora` ancla que igual hay que guardar la calcula
  `proximaFechaConHora` (lib/fechaLocal): la próxima vez que sean esas horas —hoy
  si no pasó, mañana si ya pasó— y de ahí `prepararRecurrencia` la corre al
  próximo día marcado. Nunca queda vencida, que es lo que importa: el usuario
  elige una hora sin ver ninguna fecha, así que un ancla en el pasado sonaría al
  instante sin que nadie lo pidiera.
- Cambiar de recurrencia **no pierde lo elegido**: al pasar a una sin fecha se
  hereda la hora del `datetime-local`, y al volver a una con fecha se prellena
  con el ancla calculada desde la hora.
- Debajo de los campos, **"Primera vez: …"**, sólo cuando la fecha no está a la
  vista. Sin eso el usuario elegiría una hora y no tendría forma de ver qué día
  cae la primera vuelta. Se calcula con las mismas dos funciones que corren al
  guardar, no con una cuenta aparte.
- **Chips de días** (`.rec-dias`), sólo cuando el selector está en "Días
  específicos": siete toggles Lun→Dom que se **reparten una sola fila** y se
  encogen juntos. Con ancho fijo, a 375px entraban seis y el domingo caía solo en
  una segunda fila: la semana se leía cortada justo donde no corresponde.
  Repartida, se lee como una semana a cualquier ancho (verificado hasta 320px).
  Se valida que haya al menos uno antes de guardar.
- **Indicador:** una flecha circular + texto corto en la fila de recordatorio
  (`/reminders` y Hoy comparten `RecordatorioRow`) y en la ficha de Biblioteca,
  colgando de la fecha. Para `dias_semana` el texto son **los días** ("Lun, Mié,
  Vie") en vez de "Cada semana" — que es la información que distingue este tipo.
  Mismo tamaño y tono que el resto del meta: es una marca, no una alerta.
- El armado de esa marca vive en `marcaRecurrencia` (lib/recurrencia) y no en los
  componentes, porque la usan tres lugares y para `dias_semana` hay que convertir
  los días de UTC a la zona del usuario antes de nombrarlos: si esa conversión se
  copiara en cada componente, alcanzaría con olvidarla en uno para que la misma
  repetición se leyera distinto en dos pantallas que se ven a la vez.
- Los tres caminos que **guardan** una recurrencia (el form manual, el `create`
  de la IA y el `update`) pasan por `prepararRecurrencia`, que hace la conversión
  local→UTC y el enganche de la primera fecha. Misma razón: cuando eso vivía
  suelto en cada uno, bastaba con olvidar el enganche en uno para que ese camino
  guardara una primera fecha en un día que el usuario no había marcado.
- **"Marcar hecho"** hace lo mismo en los dos casos, pero en un recurrente cierra
  **esta** vuelta (el `title` lo aclara). Las dos páginas ahora reflejan **lo que
  devuelve el repo** en vez de asumir `'hecho'`: un recurrente se mueve de
  "Vencidos" a "Próximos" a la vista.

### Asistente

`recordatorio_recurrencia` en `proposeCreateItem` y `proposeUpdateItem`, con el
system prompt enseñado a mapear "todos los días", "cada semana", "todos los
meses". En el update acepta además el centinela `"ninguna"`, que **apaga la
repetición sin borrar el recordatorio** (distinto de `quitar_recordatorio`, que
lo elimina). El valor se valida en `actions.ts`: la columna tiene un CHECK y un
valor inventado por el modelo haría fallar la escritura entera, así que cualquier
cosa fuera del enum degrada a "una sola vez".

Para días concretos, `recordatorio_dias` (array de enteros 0-6). Van en escala
**LOCAL**, igual que `recordatorio_fecha_hora` viaja como hora local ingenua: el
frontend convierte las dos cosas al confirmar. El prompt insiste en la
distinción que el modelo tiende a errar — "todos los martes" es `dias_semana`
con `[2]`, **no** `semanal` a secas — y en que al cambiar días mande la lista
completa que queda, no sólo los que se agregan. Un `dias_semana` que llegue sin
días válidos descarta la recurrencia entera en vez de guardar un recordatorio
que después no se podría reprogramar.

La tarjeta de preview muestra los días **antes** de confirmar ("se repite los
Lun, Mié, Vie"), que es justo lo que hay que poder revisar.

Un cuidado en `AssistantDrawer`: `upsertRecordatorio` pisa fecha **y**
recurrencia de una, así que se completa el campo que la acción no trae con el
valor actual. Sin eso, "movelo a las 10" borraría el "todos los días" de un
recordatorio que ya se repetía.

#### `recordatorio_hora`: la IA tampoco calcula fechas

Mismo criterio que el form: con `diario` y `dias_semana` el asistente manda
**`recordatorio_hora`** (`"HH:mm"`) y **no** `recordatorio_fecha_hora`. La
primera vuelta la calcula el cliente con `proximaFechaConHora`, la misma función
que usa el form manual. Con `semanal` y `mensual` sigue mandando la fecha, porque
ahí es la que define el día.

El motivo no es sólo simetría: pedirle al modelo "el próximo lunes/miércoles/
viernes a las 7" es aritmética de calendario que no tiene por qué hacer bien, y
un error ahí produce un recordatorio que arranca el día equivocado o directamente
vencido. Ahora esa cuenta no se la pedimos.

Como red de seguridad para las dos recurrencias que **sí** siguen necesitando
fecha, `aplicarAccionCrear` corre con `proximaOcurrencia` cualquier ancla
recurrente que llegue en el pasado. No aplica a los de una sola vez: ahí una
fecha pasada puede ser deliberada y no hay "próxima vuelta" que calcular.

La hora se valida en `actions.ts` igual que la recurrencia: `"7"`, `"las siete"` o
`"25:00"` se descartan (y `"7:05"` se normaliza a `"07:05"`) en vez de viajar
hasta el cliente y producir un `Invalid Date`.

#### El bug de "contenido" vacío, y por qué el prompt lo causó

Al agregar la recurrencia, el asistente empezó a crear recordatorios recurrentes
correctos pero con **`contenido` vacío**. No hubo ningún camino de código que lo
pisara: `mapProposedAction` copia `contenido` antes e independientemente del
bloque de recurrencia, y `contenidoDeAccionCrear` cae a `{ texto: '' }` cuando
falta — por eso salía vacío en silencio en vez de fallar.

La causa fueron los **ejemplos trabajados** que se sumaron al system prompt.
`contenido` nunca estuvo en `required` (sólo `tipo`), así que lo único que lo
llenaba era el prompt; y los dos ejemplos nuevos enumeraban los campos de un
create-con-recordatorio **omitiendo `contenido`**. Uno de ellos era, palabra por
palabra, el pedido que falló ("recordame ir al gym los lunes, miércoles y viernes
a las 7"). El modelo tomó el ejemplo más específico y lo leyó como una lista
completa de campos.

Lección que queda: **un ejemplo que enumera campos se lee como exhaustivo.** El
arreglo fue por los tres lados a la vez — una regla explícita de que todo create
lleva siempre el QUÉ del item (y que los ejemplos de abajo sólo listan los campos
de recordatorio para no repetirse), la descripción de `contenido` en imperativo y
marcada OBLIGATORIA, y los dos ejemplos corregidos para incluirlo.

## Borrar cuenta

La única acción de la app que no se puede deshacer. Hasta acá, una cuenta creada
no se podía cerrar: quedaba viva para siempre, con todos sus datos, aunque el
dueño no la quisiera más.

Va en **rama aparte** (`feat/borrar-cuenta`), justamente porque borra datos
reales sin vuelta atrás y conviene mirarla antes de que llegue a producción.

### Por qué no se puede hacer desde el cliente

Borrar una fila de `auth.users` sólo lo permite el admin API
(`auth.admin.deleteUser`), y ése exige el `service_role`. Esa key no puede
existir en el navegador —quien la tenga lee y borra los datos de TODOS los
usuarios—, así que el borrado tiene que pasar por una Edge Function.

`SUPABASE_SERVICE_ROLE_KEY` ya lo inyecta la plataforma en toda Edge Function (es
el mismo que usa `send-reminder-notifications`): **no hay ningún secret nuevo que
configurar.**

### La cascada existe, y por eso hay UN SOLO delete

Antes de escribir nada se revisaron las migraciones, no se asumió. Las seis
tablas con `user_id` propio —`temas`, `items`, `user_ai_settings`, `ai_usage`,
`push_subscriptions`, `ai_call_log`— declaran
`references auth.users (id) on delete cascade`, y `recordatorios` cae por
cascada de `items` (`item_id not null references items on delete cascade`).

Con eso, la función hace **un solo** `deleteUser` y no borra tabla por tabla. No
es pereza: la cascada corre DENTRO de la misma transacción que el `DELETE` de
`auth.users`, así que el borrado es **atómico** — o se va todo, o no se va nada.
Borrar a mano desde la función serían seis pedidos HTTP independientes, y una
caída en el cuarto dejaría la cuenta viva a medio vaciar, que es exactamente el
estado que había que evitar.

Confiar en la cascada es confiar en el esquema, así que después del borrado hay
un **barrido de verificación** con el `service_role` (que no ve RLS, así que ve
todo lo que hubiera quedado): cuenta filas en las seis tablas y, si sobrevivió
algo, contesta 500 nombrando qué quedó en vez de un `ok` sobre un borrado a
medias.

### Nunca la cuenta de otro

El `user_id` sale de `auth.getUser()` sobre el JWT del pedido. El body **no se
lee para nada** — el cliente ni siquiera manda uno (`body: {}`, verificado en el
navegador). Es la única defensa que importa acá, porque el cliente admin bypassa
la RLS: si el id viniera del body, cualquier usuario autenticado podría borrar a
cualquier otro.

### La confirmación es fricción a propósito

Un "¿estás seguro?" con el botón ya habilitado se aprieta por inercia; la mano es
más rápida que la lectura. El diálogo pide **escribir `ELIMINAR`** y sólo
entonces enciende el botón final. La comparación es `texto.trim() === 'ELIMINAR'`
(`confirmacionValida`, función pura exportada): tolera espacios de un pegado,
pero **no** ignora mayúsculas — que "eliminar" no alcance es el punto.

Antes de pedir la palabra se dice **qué** se borra, con nombre: ítems, temas,
configuración de IA (incluida la API key), notificaciones push, usuario y correo.
"Se borrará tu cuenta" no es información; la lista sí.

Visualmente estrena `.btn-rust` (rust **macizo**). El delineado `.btn-outline` ya
estaba gastado en cosas reversibles —cerrar sesión, quitar la API key—, así que
no podía ser también el aviso de "esto no se deshace". El diálogo
(`.confirm-modal`) reusa el telón `.drawer-overlay` pero, a diferencia del sheet
de "nuevo ítem", **no** se convierte en bottom-sheet en pantallas angostas: el
bottom-sheet se siente descartable, y esto es lo contrario.

### Sin conexión no se ofrece

El borrado vive en el servidor: no hay nada que encolar en el outbox ni forma
honesta de prometerlo. El botón se apaga y se dice por qué, mismo criterio que
guardar el nombre o activar la IA.

### El orden del lado del cliente

1. **Primero el servidor.** Si falla, no se toca NADA local: la cuenta sigue
   viva, el espejo local intacto y el diálogo queda abierto con el error para
   reintentar sin volver a tipear.
2. Con el `ok`: marca en `sessionStorage` → `signOut({ scope: 'local' })` →
   baja la suscripción push del navegador → se vacía y borra la IndexedDB →
   se limpia `localStorage`.

El `signOut` va **antes** de limpiar y no al final: al caer la sesión se
desmonta el layout privado y con él el motor de sync y el watcher de
recordatorios, así que nadie queda leyendo ni escribiendo la base mientras se la
vacía. Y es `scope: 'local'` porque el signOut normal le avisa al servidor, que
ya no tiene ni usuario ni sesión que revocar.

`wipeLocalDatabase` (en `db.ts`) hace dos pasos: **vacía** los stores uno por uno
—una transacción `readwrite` corre aunque otra pestaña tenga la base abierta, así
que esto es lo que de verdad garantiza que no quede información— y recién después
intenta **borrar** la base entera, best-effort contra un timeout de 4 s, porque
`deleteDB` se queda esperando indefinidamente si otra pestaña la bloquea.

La limpieza de `localStorage` barre por prefijo (`organizador:*` y `sb-*`) con
**una excepción: el tema**. Claro u oscuro no es un dato de la cuenta, y borrarlo
haría que la pantalla cambiara de color justo en el segundo en que se confirma un
borrado irreversible.

El login lee la marca de `sessionStorage` en el inicializador del estado (no en
un efecto, para que el mensaje esté en el primer pintado) y la consume: se ve una
vez y no reaparece al recargar.

### Verificación

`npm run build` limpio. `npm run lint` con **0 errores** (siguen los 3 warnings
previos de `ProposedActionCard.tsx`, `PushSettings.tsx` y `AuthContext.tsx`).

**Nada de esto tocó la cuenta real.** El navegador de verificación no tenía
sesión iniciada, así que no había forma de llegar a un borrado de verdad. Se usó
un harness temporal (`_borrar-cuenta-harness.html` + `src/_harnessBorrarCuenta.tsx`,
borrados después) que monta el componente REAL contra el CSS REAL, y un `fetch`
interceptado para simular las respuestas del servidor sin que saliera ni un
pedido — confirmado con `read_network_requests`: **cero llamadas** a
`supabase.co`.

Detalle del harness que vale anotar: la primera versión estaba en `public/` y no
arrancaba. Los archivos de `public/` se sirven sin la transformación de HTML de
Vite, así que faltaba el preámbulo de react-refresh y el módulo moría antes de la
primera línea. Movido a la raíz del proyecto, funcionó.

Verificado:

- **Palabra exacta**: `eliminar`, `Eliminar`, `ELIMINA`, `ELIMINARR` y `ELlMINAR`
  (con L minúscula infiltrada) dejan el botón apagado; `ELIMINAR`, `ELIMINAR ` y
  `  ELIMINAR  ` lo encienden.
- **Estados visuales en claro y oscuro, desktop y 375 px**: bloque de Ajustes,
  diálogo cerrado/abierto, botón apagado y encendido, error, y `scrollWidth ===
  innerWidth` (sin desborde horizontal).
- **En vuelo**: el botón pasa a "Borrando…", los dos botones y el input quedan
  deshabilitados, y el click en el telón **no** cierra el diálogo.
- **Error del servidor**: con un 500 simulado, el mensaje real de la función
  llega a la pantalla con sus `restos` ("…quedaron datos sin eliminar
  (ai_usage (3), push_subscriptions (1))"), el diálogo sigue abierto y el botón
  vuelve a habilitarse. Esto prueba el parseo de `error.context`, que
  `functions.invoke` deja sin leer.
- **Camino feliz completo**, contra un origen aparte (`http://[::1]:5173`, otro
  origen para el navegador → storage propio y vacío, el mismo truco del ítem de
  recuperar contraseña) sembrado con datos falsos: la base `organizador`
  **desaparece**, `localStorage` queda **sólo** con `organizador:theme`, la marca
  de sessionStorage queda puesta, y sale **una sola** llamada, a
  `/functions/v1/delete-account`, con body `{}`.
- **El aviso en el login**: con la marca puesta, la pantalla de sesión muestra
  "Tu cuenta y todos tus datos se borraron…" en el primer pintado, y al recargar
  ya no aparece.

`npx deno check supabase/functions/delete-account/index.ts` limpio, y la suite
completa (`npx deno test src/lib/ supabase/functions/`) en **230 passed /
0 failed**. Deno no está instalado en la máquina, pero `npx deno` lo resuelve.

### Desplegada, y probada sin poder borrar nada

`supabase functions deploy delete-account` → proyecto `uesnorbrpeosynabobha`,
estado ACTIVE, versión 1, **`verify_jwt: true`**. Ningún secret nuevo.

Contra la función YA desplegada, cinco pruebas que por construcción no pueden
borrar nada (sin un JWT de usuario no hay a quién borrar):

| Caso | Resultado |
| --- | --- |
| Sin `Authorization` | `401 UNAUTHORIZED_NO_AUTH_HEADER` (corta el gateway) |
| Con la anon key | `401 {"error":"Sesión inválida o expirada."}` |
| Body con `user_id` ajeno + anon key | `401` idéntico al anterior |
| `GET` | `405 Method not allowed` |
| `OPTIONS` | `200` + CORS correcto |

La segunda es la que importa: la anon key **sí** es un JWT válido y pasa el
gateway, así que el 401 lo devuelve NUESTRO código —`auth.getUser()` sobre un
token que no es de ningún usuario—. Eso prueba que la función corrió y que la
puerta real es `getUser()`, no el gateway.

La tercera es el requisito "nunca la cuenta de otro" verificado en vivo: se mandó
un `user_id` real en el body y la respuesta fue **idéntica** a la de un body
vacío. El body no autoriza nada porque no se lee.

**Lo único que queda sin verificar** (no se puede sin borrar una cuenta de
verdad): que `deleteUser` + la cascada efectivamente vacíen las siete tablas en
el proyecto real, y el barrido de verificación posterior. Se prueba creando una
cuenta descartable desde el login y borrándola.

## Notificaciones: contenido más claro + posponer

Dos mejoras sobre el mismo aviso (local y push), pensadas para no abrir la app
sólo para posponer algo.

### Contenido más informativo

Título y cuerpo cambiaron de forma: antes el título era siempre "Recordatorio"
y el cuerpo el contenido del item. Ahora el título ES el contenido del item
("Tomar la pastilla" en vez de "Recordatorio"), y el cuerpo es contexto breve
—el nombre del tema y, si se repite, una marca corta ("Se repite: Lun, Mié,
Vie")— separados por " · " cuando hay los dos, o el genérico de siempre si no
hay ninguno.

El armado vive en `src/lib/notificacionRecordatorio.ts`
(`contenidoNotificacion` + `resumenContenido`, que se separó de
`recordatorios.ts` a propósito: ese archivo importa `supabase.ts`, que lee
`import.meta.env` y no corre bajo `deno test`; sacando estas dos funciones
puras a su propio módulo, sí se pueden testear). El nombre del tema sale de
`repo.ts::mapaNombresTema()` (lookup por id contra el espejo local).

Del lado del servidor hay un gemelo: `supabase/functions/send-reminder-
notifications/resumen.ts` (puerto de `resumenContenido` + el parseo mínimo de
tabla que necesita) y `marcaRecurrenciaCorta` en el `recurrencia.ts` de esa
carpeta. La parte que no tiene un gemelo EXACTO es `dias_semana`: convertir
"días guardados en UTC" a "días en la zona del usuario" necesita saber esa
zona, y el cliente la conoce (browser) pero el Edge no (Deno corre en UTC). El
Edge asume Argentina fija (UTC-3, sin horario de verano) —la misma asunción
que ya hacía `recurrencia.ts` para la aritmética de fechas— derivando el
corrimiento de la hora UTC de la propia fecha en vez de la hora local del
proceso, para que el resultado no dependa de en qué TZ esté configurado el
server. Verificado con tests dedicados (no hay paridad automática con el
cliente para este caso, por lo mismo: el proceso de test no necesariamente
corre en hora argentina).

El badge (ícono monocromo chico de Android) pasó a ser dedicado
(`public/badge.svg`, una campana simple) en vez de reusar el ícono a color de
la app, que a 24dp se pierde.

### Posponer desde la notificación

Dos botones (`Notification.actions`, límite práctico de acciones que
soportan los navegadores): "Posponer 15 min" y "Posponer 1 hora"
(`ACCIONES_POSPONER` en `notificacionRecordatorio.ts`, compartida por el aviso
local y el push). Tocar uno reprograma sin abrir la app; tocar el CUERPO sigue
abriendo `/reminders` como siempre.

El manejo vive en `sw.ts::notificationclick`, que ahora mira `event.action`.
La reprogramación (`repo.ts::posponerRecordatorio`) mueve `fecha_hora` a AHORA
+ minutos —no a la fecha vencida original— y no toca `recurrencia` ni
`recurrencia_dias`: posponer corre sólo esta próxima vuelta, no cambia el
patrón. Pasa por el mismo camino offline-first de siempre (espejo local +
outbox), así que funciona igual sin conexión.

**Cambio de arquitectura que esto forzó:** para que `sw.ts` pudiera importar
`repo.ts` (y por lo tanto `sync.ts`, transitivamente), `sync.ts` tenía que
poder tipar bajo `lib: ["ES2022", "WebWorker"]` (sin `dom`, que es el lib de
`tsconfig.worker.json`). `startSyncEngine` usaba `window`/`document`
directamente, que no existen en ese lib ni en un service worker de verdad. Se
lo sacó de `sync.ts`: el enganche de eventos (`online`/`offline`/foco/
visibilidad/intervalo) ahora vive en `SyncEngine.tsx` (que sí tiene DOM,
siendo un componente), y `sync.ts` quedó con primitivas sin DOM que ese
enganche llama (`setSyncUser`, `noteOnline`, `noteOffline`,
`refreshOnlineState`, `noteLastSyncAt`, `cancelPendingSync`,
`refreshPending`); `requestSync` pasó de `window.setTimeout` a `setTimeout` a
secas (existe sin calificar en los dos libs). Mismo motivo llevó
`ensurePersistentStorage` (usa `navigator.storage.persist()`, que NO existe en
un service worker por spec, a diferencia de `persisted()`) de `db.ts` a su
propio archivo `src/lib/persistentStorage.ts`. También se completó a mano
`NotificationAction`/`NotificationOptions.actions` en
`src/types/notification-actions.d.ts`: esta versión de TypeScript todavía no
los tiene en `lib.dom.d.ts` ni en `lib.webworker.d.ts`, aunque los navegadores
los soportan hace años.

**Verificado:** `tsc -b` limpio (los tres proyectos: app, node, worker),
`vite build` genera `dist/sw.js` con el service worker completo (`repo.ts` +
`sync.ts` + `@supabase/supabase-js` incluidos: el cliente de Supabase
construye bien en un SW porque ya cae solo a almacenamiento en memoria cuando
no hay `localStorage`, y `requestSync` ya no necesita `window`), `npx eslint .`
sin errores, y 174 tests unitarios (`deno test`: 156 del lado cliente + 18 del
Edge, incluye `fechaPospuesta`, `contenidoNotificacion` y
`marcaRecurrenciaCorta`). Edge Function `send-reminder-notifications`
redesplegada (`--no-verify-jwt`, incluye los dos archivos nuevos `resumen.ts`
y el `recurrencia.ts` ampliado).

**Lo único que no se puede probar sin permisos reales de notificación** (queda
para el usuario, con la app cerrada y con la app abierta): crear un
recordatorio, esperar el aviso, tocar "Posponer 15 min" y confirmar que
`/reminders` muestra la fecha nueva sin haber abierto la app.

## Deploy

### GitHub

- Repo: <https://github.com/Raul-coder17/Organizador-IA> (remote `origin`,
  rama `master`). El push incluye todo el código, `PLAN_ORGANIZADOR.md`, el
  mockup de referencia y `render.yaml`. **No** se versionan `.env`,
  `node_modules`, `dist`, ni `supabase/.temp` (gitignored, verificado).
- No hay secretos en el repo: la clave privada VAPID, `AI_KEY_ENCRYPTION_SECRET`
  y `CRON_SECRET` viven solo como secrets de Supabase; `.env` (con la anon key
  y la VAPID pública) está ignorado y `.env.example` solo tiene placeholders.

### Render — sitio estático (config en `render.yaml`)

[`render.yaml`](render.yaml) define un Static Site: `buildCommand: npm run build`,
`staticPublishPath: ./dist`, rewrite SPA (`/* → /index.html`) y `Cache-Control:
no-cache` para `sw.js`, `registerSW.js` y `manifest.json` (así el navegador
toma siempre el último service worker tras cada deploy).

**Pasos que tenés que hacer vos en render.com (yo no puedo, requiere tu cuenta):**

1. Entrá a <https://dashboard.render.com> → **New +** → **Static Site** (o
   **Blueprint** si querés que lea `render.yaml` directo).
2. **Conectá el repo de GitHub** `Raul-coder17/Organizador-IA` (autorizá a
   Render a acceder a tu GitHub si te lo pide). Elegí la rama `master`.
3. Si NO usaste Blueprint, completá a mano: **Build Command** = `npm run build`,
   **Publish Directory** = `dist`. (Con Blueprint, Render los toma del
   `render.yaml`.)
4. **Environment Variables** — agregá estas tres (son **públicas**, no secretas,
   pero Vite las necesita en el build; tomá los valores de tu `.env` local):
   - `VITE_SUPABASE_URL` = `https://uesnorbrpeosynabobha.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (tu anon key `sb_publishable_...`)
   - `VITE_VAPID_PUBLIC_KEY` = `BGyx8cAZkUcXUH6Ok07mAfUtmNwtLBTN-Yh5kk3y8HF0xKADfLl31yp14XSPFzWlHBaeUSa1SgT0ZcWqRwgGXiw`
5. **Create Static Site** y esperá el primer deploy. Te queda una URL tipo
   `https://organizador-ia.onrender.com`.

**No hace falta tocar Supabase para CORS:** las Edge Functions que llama el
navegador (`manage-ai-key`, `ai-assistant`) ya responden con
`Access-Control-Allow-Origin: *` y manejan el preflight `OPTIONS`, así que
andan desde cualquier dominio (incluido el de Render).
`send-reminder-notifications` no tiene CORS a propósito: solo la dispara el cron
(server-to-server), nunca el navegador.

**⚠️ Notificaciones push y el dominio:** las suscripciones Web Push están
**atadas al origen (dominio)**. La suscripción que activaste en `localhost` **no
sirve** en `https://…onrender.com` — es otro origen. Una vez desplegado, entrá a
**Settings → Notificaciones → Activar notificaciones push** en el dominio de
Render y aceptá el permiso de nuevo, para crear la suscripción de ese origen.
(La `push_subscriptions` de localhost queda huérfana; podés ignorarla o
desactivarla desde ahí.) El resto —recordatorios, cron, envío— ya está del lado
del servidor y no depende del dominio del frontend.

## Changelog

- 2026-07-27 — **Gestión de temas desde Biblioteca**. Cada chip de tema (no
  "Todos los temas" ni "Sin tema", que no son temas reales) suma un botón
  "⋮" que abre un menú chico con las mismas 7 muestras de color y el mismo
  "Borrar tema" que ya existían en `ItemForm` — sin duplicar lógica: el
  swatch grid vive en `TemaColorPicker.tsx` y la cuenta+confirmación+borrado
  en `lib/temaAcciones.ts`, y `ItemForm` pasó a consumir esas mismas piezas.
  El menú nuevo (`TemaOpcionesMenu.tsx`) sigue el criterio visual de
  `NuevoItemSheet` — modal centrado ≥900px / bottom-sheet <900px, mismo
  telón `.drawer-overlay` — y llama a `updateTemaColor`/`deleteTema` de
  `repo.ts` directo (offline-first, sin cambios de lógica), avisando con
  `emitLocalChange()` como ya hacía `NuevoItemSheet`. Si el tema borrado era
  el filtro activo, la Biblioteca vuelve a "Todos los temas". Se mantuvo el
  selector de `ItemForm` (no se reemplazó, sólo se refactorizó). `tsc -b`,
  `vite build` y `eslint` limpios. Verificado en el harness: abrir/cerrar
  por telón, cambiar color (con reflejo instantáneo en el punto del chip de
  Biblioteca) y el selector de `ItemForm` sin regresión, en claro/oscuro y
  desktop (modal)/mobile 390px (bottom-sheet). Borrar un tema real no se
  probó en vivo (es destructivo) — la ruta comparte código con el borrado ya
  validado desde `ItemForm`.
- 2026-07-27 — **Notificaciones: contenido más claro + posponer** (ver
  sección propia). Título = contenido del item, cuerpo = tema + marca de
  recurrencia (mismo criterio en el aviso local y el push, con gemelos
  `src/lib/notificacionRecordatorio.ts` /
  `supabase/functions/send-reminder-notifications/resumen.ts`), badge
  dedicado (`public/badge.svg`), y dos botones "Posponer 15 min"/"Posponer 1
  hora" en la notificación que reprograman sin abrir la app
  (`repo.ts::posponerRecordatorio`, mismo camino offline-first de siempre).
  Forzó separar el enganche DOM de `sync.ts` hacia `SyncEngine.tsx` para que
  `sw.ts` pudiera importar `repo.ts` sin arrastrar `window`/`document` a un
  archivo que tipa bajo `lib: webworker`. `tsc -b`, `vite build` y
  `eslint` limpios; 174 tests unitarios (`deno test`, 156 cliente + 18 Edge).
  Edge Function redesplegada. Falta la prueba en vivo del botón "Posponer"
  con permisos de notificación reales (app abierta y cerrada).
- 2026-07-26 — **Borrar cuenta desde Ajustes** (rama `feat/borrar-cuenta`, sin
  commitear). Nueva Edge Function `delete-account`: saca el `user_id` del JWT
  vía `auth.getUser()` —el body NO se lee, así que no hay forma de pedir el
  borrado de otro— y hace UN solo `auth.admin.deleteUser` con el
  `service_role`. Un solo delete a propósito: se revisaron las migraciones y las
  seis tablas con `user_id` (`temas`, `items`, `user_ai_settings`, `ai_usage`,
  `push_subscriptions`, `ai_call_log`) ya declaran `on delete cascade` contra
  `auth.users`, y `recordatorios` cae por cascada de `items`; la cascada corre
  en la MISMA transacción que el delete, así que el borrado es atómico —borrar
  tabla por tabla serían seis pedidos independientes y una caída en el cuarto
  dejaría la cuenta a medio vaciar. Igual no se confía a ciegas en el esquema:
  después hay un barrido con el `service_role` que cuenta filas en las seis
  tablas y devuelve 500 nombrando lo que haya quedado en vez de un `ok` falso.
  No hace falta configurar ningún secret nuevo: `SUPABASE_SERVICE_ROLE_KEY` ya
  lo inyecta la plataforma. UI: bloque nuevo al final de Ajustes → Cuenta, con
  `.btn-rust` (rust macizo — el delineado `.btn-outline` ya estaba gastado en
  cosas reversibles) y un diálogo `.confirm-modal` que enumera qué se borra y
  exige escribir `ELIMINAR` (`confirmacionValida`, `trim()` sí, mayúsculas no)
  antes de encender el botón final; centrado en todos los tamaños, sin volverse
  bottom-sheet en móvil porque el bottom-sheet se siente descartable. Sin
  conexión el botón se apaga con su explicación. Del lado del cliente
  (`src/lib/borrarCuenta.ts`) el orden es primero el servidor —si falla no se
  toca nada local y se puede reintentar— y después
  `signOut({ scope: 'local' })` (antes de limpiar, para que se desmonten el
  motor de sync y el watcher y nadie escriba la base mientras se la vacía),
  baja de la suscripción push, `wipeLocalDatabase` (vacía los stores primero
  —eso corre aunque otra pestaña tenga la base abierta— y recién después
  `deleteDB` contra un timeout de 4 s) y limpieza de `localStorage` por prefijo,
  preservando `organizador:theme` porque el modo claro/oscuro no es un dato de
  la cuenta. El login muestra el aviso una sola vez, leído en el inicializador
  del estado para que esté en el primer pintado. Verificado sin tocar ninguna
  cuenta: el navegador de prueba no tenía sesión, y las respuestas del servidor
  se simularon interceptando `fetch` (cero llamadas reales a `supabase.co`,
  confirmado por red). Camino feliz completo probado en un origen aparte
  (`http://[::1]:5173`) con datos sembrados: la IndexedDB desaparece,
  `localStorage` queda sólo con el tema y sale un único POST con body `{}`.
  Desplegada con `supabase functions deploy delete-account` (ACTIVE, v1,
  `verify_jwt: true`) y probada contra la función viva con cinco casos que no
  pueden borrar nada: sin `Authorization` corta el gateway (401), con la anon
  key corta NUESTRO `getUser()` (401 en español — prueba que el código corrió),
  un `user_id` ajeno en el body da la respuesta idéntica a un body vacío
  (el body no se lee), `GET` da 405 y `OPTIONS` da 200 con el CORS correcto.
  Queda sin verificar —no se puede sin borrar una cuenta real— que la cascada
  vacíe las tablas en producción. `tsc -b && vite build` limpio, lint 0 errores,
  `deno check` limpio y 230 tests passed / 0 failed.
- 2026-07-26 — **Dictado de voz en el chat del asistente**. Botón de
  micrófono junto al input de `AssistantDrawer`, con la Web Speech API nativa
  del navegador (`SpeechRecognition`/`webkitSpeechRecognition`) — sin IA, sin
  gastar cuota de Gemini, todo corre del lado del cliente. Mantener presionado
  (mouse o touch) graba y transcribe en español (`lang: 'es-ES'`); soltar (o
  que el mouse/dedo se salga del botón) para. El texto reconocido se ESCRIBE en
  el mismo input donde ya se tipea a mano —se suma a lo que hubiera, no lo
  pisa— y nunca se envía solo: el usuario confirma con "Enviar" como siempre.
  Nuevo hook `src/lib/useDictadoVoz.ts`: declara tipos mínimos propios para la
  API (no hay tipos oficiales de TS, ni en `lib.dom.d.ts`, para algo no
  estándar), y expone `dictadoVozSoportado` (chequeo síncrono de si el
  navegador tiene la API) para que Firefox/Safari viejo simplemente no
  dibujen el botón, en vez de mostrar uno roto. `onresult` llega con el texto
  COMPLETO reconocido de la sesión de grabación (no un delta, la API reescribe
  sus resultados interinos a medida que refina), así que `AssistantDrawer`
  guarda una foto del input al apretar (`inputAlEmpezarRef`) y pega el
  transcript sobre esa base en cada actualización — no sobre el `input` del
  último render, que ya incluiría lo dictado. Error de permiso denegado
  (`not-allowed`/`service-not-allowed`) muestra un mensaje en español debajo
  del input; `no-speech` (nada detectado) no hace nada disruptivo, el input
  queda como estaba. Visual: mismo tamaño/forma que `.icon-btn` (34px, borde,
  radio 3px) en estado normal; grabando pasa a fondo `--color-rust` con texto
  `--color-moss-ink` (mismo par que `.nav-badge`/`.tab-badge`, ya el "esto
  necesita tu atención" del sistema) y pulso vía `@keyframes mic-pulse`,
  respetando `prefers-reduced-motion` igual que `.sync-status--sync`.
  Verificado con un harness estático servido por el propio Vite dev
  (`public/_mic-harness*.html`, borrado después) contra `src/index.css` real:
  estados idle/recording/disabled en claro y oscuro, y la lógica de
  `dictadoVozSoportado` probada explícitamente con un objeto `window` simulado
  sin `SpeechRecognition`/`webkitSpeechRecognition` (confirma que el botón no
  se renderiza). No se pudo probar el reconocimiento de voz real (requiere
  permiso de micrófono del usuario) ni un navegador sin la API de verdad
  (Firefox) — sólo la detección de su ausencia. `tsc -b && vite build` limpio.
- 2026-07-26 — **Auditoría del asistente, paso 3: la tarjeta y la base ya no
  pueden divergir (B-2)** (misma rama `feat/recordatorios-recurrentes`, sin
  commitear). `primeraVezDeAccionCrear` —la función que arma lo que dibuja
  `ProposedActionCard`— calculaba la primera fecha con `prepararRecurrencia`
  pero SIN el paso de `primeraVuelta`, que es lo que corre una recurrencia
  vencida a su próxima ocurrencia real. Con una recurrencia que arrancaba en el
  pasado (el modelo se equivoca de día en "semanal"/"mensual", o vencida por
  cualquier otro motivo), la tarjeta podía mostrar una fecha ya pasada mientras
  que `aplicarAccionCrear` —que sí llamaba a `primeraVuelta`— guardaba la
  próxima vuelta real: el usuario confirmaba una fecha y se guardaba otra.
  Fix: `primeraVuelta` se exportó desde `accionesPropuestas.ts` (donde ya
  vivía, privada) y `primeraVezDeAccionCrear` pasó a llamarla — misma función en
  los dos lugares, no una reimplementación paralela. Cierra la clase completa
  de discrepancia (cualquier recurrencia vencida al proponerse, no solo el caso
  que la disparó), porque los cuatro tipos de recurrencia pasan por el mismo
  `prepararRecurrencia` + `primeraVuelta`. De paso, dos ajustes para que esto
  fuera testeable de verdad (no con una reimplementación paralela en el test):
  `accionesPropuestas.ts` pasó a importar `./repo` (que arrastra el cliente de
  Supabase) DINÁMICO adentro de `aplicarAccionCrear`/`resolverTemaId` en vez de
  arriba del módulo — mismo comportamiento en el navegador, pero el resto del
  archivo (`primeraVuelta`, `fechaLocalDeAccion`, etc., que son puros) queda
  cargable por `deno test`; y `ProposedActionCard.tsx` pasó a importar
  `formatFechaHora`/`proximaFechaConHora` de `fechaLocal.ts` en vez de
  `recordatorios.ts` (mismo re-export, sin el cliente de Supabase en el medio).
  **6 tests nuevos** en `ProposedActionCard.test.ts`: paridad tarjeta/guardado
  para los cuatro tipos de recurrencia con fecha vencida, uno que reproduce el
  bug viejo (prueba que la versión sin `primeraVuelta` SÍ quedaba vencida y que
  el fix cambia el resultado) y uno de control para "una sola vez" (una fecha
  pasada sin recurrencia no se toca, a propósito). Es el único test del repo
  que carga un `.tsx` real (para probar la función tal como vive, no una copia)
  y corre con `npx deno test --no-check --allow-env` en vez del `npx deno test`
  liso del resto de la suite: `--allow-env` porque el runtime automático de JSX
  de React lee `NODE_ENV` al cargarse, y `--no-check` porque aunque el import a
  `./repo` es dinámico, el chequeo de tipos de Deno igual resuelve su grafo
  completo —incluido `sync.ts`, que usa `navigator.onLine`/`document`/etc., que
  no están en el lib por defecto de Deno— aunque en runtime nunca se ejecuta.
  `tsc -b && vite build` (con lib DOM real) y el resto de la suite (144 tests)
  siguen limpios; lint da solo warnings ya existentes en el repo (exportar una
  función no-componente desde un archivo de componente rompe React Fast
  Refresh, mismo warning que ya tenían `AuthContext.tsx`/`PushSettings.tsx`).
- 2026-07-26 — **Auditoría del asistente, paso 2: historial estructurado**
  (misma rama `feat/recordatorios-recurrentes`, sin commitear). El historial que
  se le reenvía a Gemini dejó de ser texto plano: los turnos en que el modelo
  propuso algo se reconstruyen como el par `functionCall`/`functionResponse`
  real, con la tool y los args que emitió más el desenlace verdadero (aplicada
  con `item_id`, cancelada, error, o `sin_responder` si el usuario siguió
  escribiendo sin tocar la tarjeta). Antes, confirmar agregaba una frase genérica
  ("Listo, creé el item.") y **cancelar no agregaba nada** —bug C-1—, así que el
  modelo podía re-proponer algo ya creado o ya rechazado. Nuevo módulo puro
  `supabase/functions/ai-assistant/historial.ts` con `buildContents`, 12 tests en
  `historial.test.ts`. De paso arregla la alternancia de roles: la burbuja de
  confirmación quedó marcada `solo_ui` (se ve en el chat, no viaja) y el
  `functionResponse` se fusiona con el mensaje siguiente del usuario, así que ya
  no quedan dos turnos `model` seguidos. `collectProposals` (nuevo, en
  `actions.ts`) empareja cada call cruda con su acción para que no se desalineen.
  **Fix posterior (400 de Gemini):** el primer intento fusionaba el
  `functionResponse` con el texto nuevo del usuario en las mismas `parts` para
  dejar la alternancia estricta; Gemini lo rechazó con 400 al confirmar el gym y
  mandar el mensaje siguiente. Un content con `functionResponse` tiene que llevar
  **sólo** `functionResponse`, así que ahora va en su propio turno y quedan dos
  `user` consecutivos (resultado de la tool + mensaje nuevo), que es correcto: no
  hay turno del modelo en el medio porque las propuestas cortan el loop y vuelven
  al cliente. Lo que sí sigue mezclado —y es válido— es texto + `functionCall` en
  el turno del modelo, que es lo que Gemini mismo emite. Test de regresión en
  `historial.test.ts` + la invariante chequeada en todos los casos.
- 2026-07-26 — **Auditoría del asistente, paso 1: logging del intercambio con
  Gemini**. `ai-assistant` loguea el `contents` completo antes de *cada* llamada
  del loop (no sólo la primera), la respuesta de cada vuelta con los args
  completos de las function calls, y `client_now`. Va sólo a los logs de la Edge
  Function; no se loguea la API key ni el blob cifrado. Las líneas largas salen
  partidas en trozos numerados porque los logs de Supabase truncan.
- 2026-07-26 — **Sin fecha para "Diario" y "Días específicos"** + fix del
  `contenido` vacío (misma rama `feat/recordatorios-recurrentes`, sin
  commitear). El form esconde el selector de fecha para esas dos recurrencias y
  muestra sólo hora; la `fecha_hora` ancla la calcula `proximaFechaConHora`
  (nuevo `src/lib/fechaLocal.ts`, adonde se mudaron los helpers puros de fecha
  que vivían en `recordatorios.ts` — que los re-exporta, así ningún import
  cambió — para que `deno test` pueda cargarlos sin arrastrar el cliente de
  Supabase). Mismo criterio en el asistente, con `recordatorio_hora` nuevo en
  `proposeCreateItem`/`proposeUpdateItem`. Y el bug que abrió todo esto: la IA
  creaba el recurrente correcto pero con `contenido` vacío, causado por los
  ejemplos del prompt que enumeraban campos sin incluirlo (ver "El bug de
  'contenido' vacío"). 11 tests nuevos en `fechaLocal.test.ts` (el ancla nunca
  queda en el pasado, barriendo las 24 horas × los 7 días) y 3 en
  `actions.test.ts`.
- 2026-07-25 — **Recurrencia por días específicos** (misma rama
  `feat/recordatorios-recurrentes`, sin commitear). Cuarto tipo: `dias_semana`,
  distinto de `semanal` (que sólo suma 7 días y cae siempre en el mismo día).
  Migración `20260725160000_recordatorios_dias_semana.sql` — amplía el check de
  `recurrencia` y agrega `recurrencia_dias smallint[]` con check de rango/unicidad
  y de coherencia (los días existen si y sólo si la recurrencia es
  `dias_semana`). **Aplicada al proyecto real**; `migration list` confirma las 10
  migraciones alineadas local/remoto. El primer intento falló: el check de
  unicidad usaba una subquery (`select count(distinct …) from unnest(…)`) y
  Postgres no las acepta dentro de un CHECK (error 0A000). Se movió esa
  validación a una función `immutable` `public.dias_semana_validos(smallint[])`
  —que un CHECK sí puede llamar— y la migración se rehízo **idempotente**
  (`if exists`/`if not exists`/`or replace`) para poder re-correrla sin depender
  de que el rollback del intento fallido hubiera sido perfecto; los NOTICE del
  push confirmaron que sí lo había sido. Efecto secundario a tener presente: al
  vivir en el schema `public`, esa función queda expuesta como RPC de PostgREST.
  Es pura sobre su argumento (no toca ninguna tabla), así que no filtra nada, y
  de hecho se usó para verificar el check contra la base real: `[1,3,5]` `[2]` y
  los siete días dan `true`; `[1,1,3]` (repetido), `[7]`, `[-1]` y `[]` dan
  `false`. Convención documentada en la migración y en los dos
  gemelos: días 0-6 con 0=domingo, **en UTC**, porque toda la aritmética es en
  UTC; el cliente traduce desde/hacia la zona del usuario
  (`diasLocalesAUtc`/`diasUtcALocales`), lo que importa de 21:00 a 23:59 en
  Argentina, cuando el día local y el UTC ya no coinciden. Invariante: el día UTC
  de `fecha_hora` siempre está entre los marcados, mantenido por
  `ajustarADiaMarcado`. Guarda anti-bucle nueva en los dos lados: si el cálculo
  no avanza, se cierra como un recordatorio de una sola vez en vez de quedar
  disparando una vez por ciclo. UI: chips Lun→Dom que se reparten una sola fila
  (con ancho fijo el domingo caía solo en una segunda, hasta 320px verificado),
  validación de al menos un día, y el indicador pasa a mostrar "Lun, Mié, Vie".
  Asistente: `recordatorio_dias` en create y update, prompt que distingue
  `semanal` de `dias_semana`, y días visibles en el preview. Se extrajeron
  `marcaRecurrencia` y `prepararRecurrencia` para que los tres caminos de
  guardado y los tres de presentación no se separen. **33 tests nuevos** (199 en
  total, todos verdes), incluida la paridad mecanizada extendida a las 127
  combinaciones de días × 7 fechas base × 8 vueltas. Build y lint limpios;
  verificación visual con el harness de CSS compilado en claro/oscuro y
  900/375/320px (no pude sacar capturas: el panel del navegador no componía
  frames en esta sesión, así que la verificación fue por estilos computados +
  el harness enviado al usuario).

- 2026-07-25 — **Desplegado el ítem completo de recurrencia** (simple + días
  específicos). `send-reminder-notifications` v3 (`--no-verify-jwt`, sube también
  `recurrencia.ts`) y `ai-assistant` v10, las dos `ACTIVE`. Verificado que el
  cron arranca con el módulo nuevo: sin el header `x-cron-secret` devuelve
  401 `{"error":"No autorizado."}` limpio, y como el import de `recurrencia.ts`
  ocurre al cargar el módulo —antes del guard—, ese 401 prueba que el gemelo
  importa bien. Schema verificado por PostgREST: `recurrencia` y
  `recurrencia_dias` responden 200, y una columna inventada responde 400/42703
  como control. **Todo listo para la prueba en vivo.**

- 2026-07-25 — **Recordatorios recurrentes** (rama `feat/recordatorios-recurrentes`,
  sin mergear). Un recordatorio puede repetirse diario/semanal/mensual: al
  marcarse `enviado` o `hecho` avanza su `fecha_hora` a la próxima ocurrencia y
  vuelve a `pendiente`, en la MISMA fila. Sin fecha de fin (se corta editando el
  item o borrándolo). Migración `20260725120000_recordatorios_recurrencia.sql`
  (columna nullable + check) **aplicada al proyecto real**; `migration list`
  confirma local y remoto en `20260725120000`. La lógica vive dos veces a
  propósito —`src/lib/recurrencia.ts` y su gemelo en la Edge Function del cron,
  porque son runtimes que no se importan entre sí— y la paridad la fija un test
  que importa las dos copias y compara salidas sobre un barrido de fechas.
  Aritmética en UTC (mismo resultado en los dos lados); mensual con recorte a fin
  de mes que **no se recuerda** (31/01 → 28/02 → 28/03, limitación documentada,
  haría falta una columna de día ancla); `proximaOcurrencia` avanza hasta pasar
  el ahora, así un atrasado reengancha en vez de disparar una vez por ciclo.
  Offline-first sin nada especial (espejo local + outbox); `marcarEnviado` pasó a
  devolver la fila para que el watcher saque de "ya disparados" al que reenganchó
  —si no, un diario avisaría una sola vez por sesión—. UI: selector en
  `ItemForm`, marca de repetición en `RecordatorioRow` (/reminders y Hoy) y en la
  ficha de Biblioteca; las dos páginas ahora reflejan lo que devuelve el repo en
  vez de asumir `hecho`. Asistente: `recordatorio_recurrencia` en create/update
  (+ centinela `"ninguna"` para apagar la repetición sin borrar el recordatorio)
  y system prompt actualizado. **36 tests nuevos** (166 en total, todos verdes),
  build y lint limpios, verificación visual en claro/oscuro y desktop/~375px con
  el harness de CSS compilado. **Falta:** desplegar las dos Edge Functions y la
  prueba en vivo del usuario.

- 2026-07-25 — Recuperar contraseña por correo. Olvidarse la contraseña dejó de
  ser una puerta cerrada. Detalle completo en la sección
  ["Recuperar contraseña por correo"](#recuperar-contraseña-por-correo).
  - **Frontend:** link "¿Olvidaste tu contraseña?" en el login (tercer modo del
    mismo formulario) que llama a `resetPasswordForEmail`, y ruta nueva
    `/reset-password` con las dos contraseñas y `updateUser`. Tarjeta común
    `AuthCard` para las tres pantallas de sesión.
  - **Cambio estructural:** el `BrowserRouter` salió de adentro de
    `ProtectedRoute` y la puerta pasó a ser un layout route. Sin eso no había
    forma de tener una ruta pública, y `/reset-password` la abre justamente
    quien no puede iniciar sesión. De paso, una URL desconocida ahora redirige
    a Hoy en vez de dejar la pantalla en blanco.
  - **Decisión:** el mensaje al pedir el link es el mismo exista o no la cuenta.
    Si cambiara, la pantalla serviría para averiguar quién tiene cuenta acá.
  - **Requiere configuración tuya en Supabase** (Redirect URLs; y SMTP propio
    el día que haya un segundo usuario): ver la sección.

- 2026-07-25 — Fix: los colores de tema salían transparentes en modo claro.
  Cierra el bug pre-existente anotado en la entrada de "borrar temas".
  - **Síntoma:** en claro, los puntos de tema (Biblioteca y chips) y las siete
    muestras del selector de color del `ItemForm` no se pintaban. En oscuro
    andaban bien. De los siete `--color-tema-*`, en el `:root` de claro sólo
    salía `celeste`.
  - **Causa:** Tailwind v4 emite de `@theme` **sólo** las variables que ve
    usadas. Estos siete tokens no los consume ninguna utilidad: el color entra
    por `style` desde JS, armado en `temaColorVar()` como
    `` `var(--color-tema-${color})` ``. El escáner no ve el slug interpolado,
    así que los podaba. `celeste` sobrevivía **de casualidad**: el literal
    completo `var(--color-tema-celeste)` aparece en `temaColores.test.ts:92`,
    y el escáner de Tailwind lee también los archivos de test. Oscuro no se
    veía afectado porque `:root[data-theme="dark"]` es CSS común, no `@theme`,
    y ahí no hay poda — de ahí que el bug fuera sólo de un modo.
  - **Fix** (sólo `src/index.css`): los siete colores se mudaron a un bloque
    `@theme static` propio. `static` fuerza a emitir las variables aunque no
    se las vea usadas. Se eligió sobre la alternativa de bajarlos a un `:root`
    común porque los deja siendo tokens de tema de verdad (siguen habilitando
    utilidades tipo `bg-tema-azul` si algún día hacen falta) en vez de
    volverlos CSS suelto; y sobre marcar `static` el `@theme` grande, porque
    el problema es de estos siete y no de los tokens que sí usan utilidades.
  - **Verificación** (el harness de siempre: componentes reales sin pasar por
    el login). En el navegador, contra el CSS de producción de `dist/`, se
    montaron los tres usos reales —`.tema-dot` en `.grupo-head`, `.tema-dot`
    dentro de `.chip` y `.chip--active`, y `.swatch`/`.swatch--activa`— con
    los mismos nombres de clase y el mismo `style` inline que producen
    `ItemsPage`, `HoyPage` e `ItemForm`. 28 nodos, `getComputedStyle` de cada
    uno: **0 transparentes y 7 colores distintos**, en claro y en oscuro.
  - Control de que el fix es el que cambia algo: se rebuildeó el CSS desde
    `HEAD` limpio y se comparó. El `:root` de claro pasa de **33 a 39
    propiedades**; el diff son exactamente las 6 declaraciones recuperadas
    (`verde-agua`, `turquesa`, `azul`, `indigo`, `violeta`, `ciruela`) y nada
    más. Ninguna otra variable se perdió ni se agregó (+238 bytes de CSS).
  - Oscuro sin regresión: los siete tokens siguen resolviendo a los mismos
    `oklch(0.72 …)` de antes. El bloque `:root[data-theme="dark"]` es CSS sin
    capa y sigue ganándole al `@layer theme` donde Tailwind emite los de
    claro, así que el override no se tocó.
  - `npm run build` sin errores, `npm run lint` 0 errores (2 warnings de
    `react-refresh` pre-existentes, ajenos). Sin errores de consola.
  - **Pendiente para el usuario:** confirmarlo en vivo con datos reales —
    varios temas de colores distintos en Biblioteca, y el selector de color
    del `ItemForm`. El harness prueba el CSS, no que cada tema tenga bien
    asignado su slug en la base.

- 2026-07-25 — Borrar temas + fecha obligatoria para el tipo "recordatorio".
  - **Parte A — borrar temas.** No existía la acción (quedó pendiente después
    de la Fase 3). Hallazgo de la investigación previa: la FK ya era
    `tema_id uuid references temas (id) on delete set null`
    (`schema_inicial`), o sea que **el comportamiento pedido —los items no se
    borran, pasan a "Sin tema"— ya estaba implementado del lado del servidor**
    y no hizo falta migración ninguna.
    - `deleteTema()` en `repo.ts`, offline-first como todo el resto (espejo
      local + outbox, sin DELETE directo). NO alcanza con confiar en la
      cascada del servidor, por dos motivos que quedaron documentados en el
      código: (1) el espejo local no se entera de un cambio hecho por la FK,
      así que sin nullear a mano los items quedarían huérfanos en la UI hasta
      la próxima reconciliación; (2) el caso 100% offline —crear tema, crear
      item con ese tema, borrar el tema, todo sin red— donde `planOutbox`
      colapsa insert+delete del tema en NADA (`fold`, `tries === 0`) y el
      insert del item habría fallado con FK 23503 para siempre. Encolando el
      update del item ANTES, su propio `fold` pliega insert+update en un
      insert con `tema_id: null` y sube limpio. Mismo orden que `deleteItem`:
      primero los hijos, después el padre.
    - **Sin cambios en `sync.ts`/`syncCore.ts`**: el motor ya es genérico por
      entidad (`TABLE` mapea `tema: 'temas'` y el delete es genérico).
    - UI: el borrado vive en el bloque de tema del `ItemForm`, junto al
      selector de color. **Desviación del pedido original, a propósito:** se
      pidió un ícono por tema dentro del dropdown, pero un `<option>` no puede
      contener un botón (HTML no lo permite), y cambiar el `<select>` nativo
      por uno propio sólo para eso costaba el teclado y el picker nativo del
      celular. Se resolvió con el mismo patrón que ya usaban los swatches de
      color: seleccionar el tema y después actuar sobre él. La confirmación
      dice cuántos items pasan a "Sin tema" (contados contra el espejo local,
      así que también responde sin conexión).
    - **Punto A4 verificado empíricamente**, no por lectura: montando el
      `ItemList` REAL con tres fixtures. `tema_id = null` (resultado del
      borrado intencional) cae en **"Sin tema"**; `tema_id` apuntando a un
      tema ausente (referencia desactualizada de sync) cae en **"Tema
      eliminado"**. Son buckets distintos y el borrado intencional nunca
      produce el segundo, porque se nullea localmente ANTES de sacar el tema.
  - **Parte B — fecha obligatoria si `tipo === 'recordatorio'`.** Un
    recordatorio sin fecha no es un recordatorio. Con ese tipo desaparece el
    toggle y el campo se muestra siempre, requerido, con nota explicativa;
    para nota/lista/tabla no cambia nada. Cambiar de tipo NO pierde la fecha
    cargada: al salir de "recordatorio" con fecha puesta, el toggle queda
    prendido solo para que siga a la vista y se guarde.
    - Detalle que apareció al probarlo: con `required` a secas, el globo
      nativo del navegador ("Completa este campo") se adelantaba a la
      validación en JS y se comía el mensaje bueno. Se resolvió con
      `setCustomValidity` en `onInvalid` (y limpiándolo en `onChange`), así el
      globo nativo —que además es el accesible— dice "Un recordatorio necesita
      fecha y hora."
  - Verificado en claro/oscuro × desktop/375px montando los componentes reales
    con fixtures (sin pasar por el login). `npm run build` sin errores,
    `deno test supabase/functions/` 53/53, `npm run lint` 0 errores.
  - **Bug pre-existente encontrado de paso (NO se arregló acá, queda aparte):**
    en modo claro 6 de los 7 `--color-tema-*` no están definidos en `:root`
    (sólo sobrevive `celeste`), así que los puntos y swatches de tema se
    pintan transparentes; en oscuro andan los siete. Causa: Tailwind v4 poda
    las variables de `@theme` que no ve usadas por una utilidad, y estos
    colores se consumen con `var(--color-tema-X)` desde estilos inline en JS.
    Confirmado que es anterior a este trabajo reproduciéndolo desde HEAD
    limpio con los cambios en stash.
    → **Resuelto** en la entrada del 2026-07-25 (`@theme static`), más abajo.

- 2026-07-25 — Fix: la cuota diaria aprendida queda atada al modelo + hallazgo
  de deploy. Salió de diagnosticar "el asistente me corta en 20 aunque
  cambiamos de modelo".
  - **Hallazgo principal (no era el bug que parecía):** el cambio de modelo
    **nunca había llegado a producción**. Dos deploys distintos que no son uno:
    Render publica sólo el frontend estático desde GitHub (`render.yaml`), y el
    commit `6b7413e` estaba sin pushear (`ahead 1`) — de ahí que no apareciera
    el aviso de actualización del PWA. Pero además las Edge Functions **no las
    despliega Render**: van por `npx supabase functions deploy <slug>`, y la
    última vez que se desplegaron fue antes del cambio de modelo
    (`ai-assistant` v8 del 2026-07-22, `extract-from-photo` v2 del 2026-07-24
    10:38 UTC, contra el commit del modelo del 2026-07-25 03:26 UTC). O sea:
    producción seguía corriendo `gemini-2.5-flash`, y el `20` aprendido era
    correcto para lo que estaba efectivamente corriendo. Confirmado también por
    `ai_call_log` vacía: el freno de RPM nunca se había ejecutado.
  - **El fix igual hace falta**, porque al desplegar el modelo nuevo el `20`
    sí pasaba a ser un límite fantasma. `daily_quota_learned` ahora se guarda
    junto con `daily_quota_learned_model` (migración
    `20260725050000_quota_learned_por_modelo.sql`): el pre-flight sólo usa el
    valor si el modelo coincide con la constante `GEMINI_MODEL` de la Edge
    Function, y si no, lo ignora y lo reaprende del primer 429 real. Elegido
    por sobre el reset a mano porque **se auto-corrige en el próximo cambio de
    modelo** en vez de depender de acordarse. El valor actual además se
    reseteó a null en la misma migración (verificado en la base real).
  - **`ai_usage` no se tocó** (verificado): el contador de requests del día
    sigue igual (18 el 2026-07-24, 20 el 2026-07-23). Lo que se resetea es el
    LÍMITE aprendido, no el uso — son dos cosas distintas y el bug era sólo del
    primero.
  - `npx deno test supabase/functions/` → 53/53. `npm run build` sin errores.

- 2026-07-24 — Modelo `gemini-3.1-flash-lite` + freno proactivo de RPM + tope
  de correcciones en foto. Los tres juntos porque salieron de la misma
  auditoría (límites reales de la cuenta: RPM=15, RPD=20, no 1500/15 de la
  guía genérica).
  - **Modelo:** `ai-assistant` y `extract-from-photo` pasan de
    `gemini-2.5-flash` a `gemini-3.1-flash-lite` (no `-preview`: esa variante
    está dada de baja). Confirmado contra la doc oficial de Google
    (`ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite`) que soporta
    function calling e imagen como input. **Cambio no trivial encontrado en el
    camino:** este modelo (serie Gemini 3) reemplaza el `thinkingConfig.
    thinkingBudget` (número de tokens, serie 2.5) por `thinkingConfig.
    thinkingLevel` (enum `MINIMAL`/`LOW`/`MEDIUM`/`HIGH`) — mandar los dos
    juntos da 400. Si sólo se hubiera cambiado el string del modelo sin tocar
    esto, las dos Edge Functions habrían roto en el primer mensaje/foto.
    `ai-assistant` queda en `MINIMAL` (mismo espíritu que el `thinkingBudget:
    0` de antes); `extract-from-photo` en `LOW` (antes tenía budget 2048 de
    8192 para dejarle algo de razonamiento a la transcripción de tablas
    largas). Verificado contra documentación oficial (dos páginas
    independientes confirman el model id, y la página del modelo + búsquedas
    sobre `thinkingLevel` confirman el schema); **no se hizo una llamada real
    a Gemini** — no hay key de test disponible sin gastar cuota real de la
    cuenta del usuario, así que queda pendiente un smoke test en vivo (1
    mensaje de chat + 1 foto) después de desplegar.
  - **Freno proactivo de RPM (mejora A):** antes sólo se aprendía el límite
    DIARIO (`daily_quota_learned`); nada protegía contra RPM. Tabla nueva
    `ai_call_log` (migración `20260724190000_ai_rpm_throttle.sql`, una marca
    de tiempo por llamada real, RLS por usuario) + módulo puro `rpm.ts`
    (`decideRpmSlot`, ventana deslizante de 60s) duplicado en ambas Edge
    Functions —mismo motivo que `GeminiError`/`parseRateLimit`: deploys
    independientes—, con `GEMINI_RPM = 15` hardcodeado (a diferencia del RPD,
    no se "aprende": no hay un 429 del que derivarlo con esta granularidad).
    Se chequea ANTES de cada llamada real a Gemini (en el loop de
    `ai-assistant`, que puede llamar varias veces por turno) y devuelve el
    mismo shape que un 429 real de minuto (`rate_limit.kind: 'short'`), así
    que el frontend no cambió nada — el cooldown de `AssistantDrawer` ya
    sabía manejarlo. **16 tests unitarios** (`npx deno test
    supabase/functions/`, 53/53 OK incluyendo los 37 previos) simulan marcas
    de tiempo para probar la ventana (la llamada 16 dentro de 60s se bloquea,
    fuera de la ventana no cuenta, vuelve a permitir pasado el tiempo
    indicado) sin gastar una sola llamada real.
  - **Tope de correcciones en foto (mejora B):** `NuevoItemSheet.tsx` limita a
    `MAX_CORRECCIONES = 3` (antes no había tope). Contador visible reusando
    `.foto-correcciones` ("N de 3 correcciones usadas", mismo tono que el
    contador de cuota diaria que ya vivía ahí). Al llegar al tope, el botón
    "Esto no está bien" queda `disabled` (con `title` explicando por qué) y
    aparece una nota sugiriendo sacar la foto de nuevo. Verificado visualmente
    con un harness estático (CSS de producción, 4 estados: 0/2/3-de-3/con
    formulario abierto) en claro/oscuro × desktop/375px.
  - `npx deno test supabase/functions/` → 53/53. `npm run build` sin errores.
  - **Pendiente para el usuario:** aplicar la migración nueva (`npx supabase
    db push` o pegarla en el SQL Editor, como las anteriores) y hacer un
    smoke test real (1 mensaje + 1 foto) para confirmar el modelo en vivo.

- 2026-07-24 — **D6** (`PLAN_REDISEÑO.md` §8): contraste AA en claro + nuevo
  acento en oscuro. Dos cambios de color, ambos sólo en `src/index.css`:
  - `gold` y `slate` en modo claro (`@theme`) bajaron de luminosidad en HSL
    (mismo H/S) hasta pasar 4.5:1 contra `--color-paper`, el peor caso real
    (más oscuro que `--color-card`, y donde vive `.sync-status`): `gold`
    `#b98530→#8c6424` (2.83→**4.62**), `slate` `#7c8577→#666e62`
    (3.34→**4.61**). Medido con un script Node reproducible (luminancia
    relativa WCAG 2.1), no a ojo. Modo oscuro no se tocó en estos dos tokens.
  - `moss` / `moss-tint` / `moss-ink` en `:root[data-theme="dark"]` pasaron de
    verde a azul acero: `#5B8AA6` (antes `#6f9873`), texto `#0C1518` (antes
    `#0e120c`), `moss-tint` `#1c2624` derivado mezclando ~14% del nuevo azul
    con `--color-paper` — la misma proporción que ya daba el `moss-tint`
    verde respecto a `moss` (verificado por regresión numérica contra el hex
    viejo). Modo claro no se tocó: `moss` sigue verde ahí.
  - Verificación visual: harness estático (`_accent-check.html`, servido
    desde `public/` por el dev server y borrado después) que renderiza cada
    uso real del token con las clases/CSS de producción — nav activo,
    `side-nuevo`, `acceso--moss`, `btn-moss`, FAB de tab bar, checkbox
    marcado, burbuja de chat del usuario (`bg-moss text-moss-ink`), focus
    ring del swatch de tema, y `rem__notificado` — más el mismo harness en
    claro como control de no-regresión. El azul lee bien en todos los casos;
    el verde de claro queda idéntico al de antes.
  - `npm run build` sin errores.

- 2026-07-24 — Rediseño, **Fase 4** (ítem 14 de `PLAN_REDISEÑO.md`): **captura
  de item por foto** con Gemini Vision. Edge Function nueva
  `extract-from-photo` (mismo `gemini-2.5-flash` que el asistente —es
  multimodal, no hace falta otro modelo—, misma cuota diaria, mismo pre-flight,
  mismo manejo del 429 y los mismos mensajes en español), salida estructurada
  con `responseSchema` y normalización defensiva que hace mandar a los datos
  sobre la etiqueta del tipo. **La imagen no se guarda en ningún lado**: se
  achica en el cliente (1600px / JPEG 0.82), se reenvía y se descarta; lo único
  que persiste es el item confirmado, con `origen = 'foto'`. La propuesta viaja
  con la MISMA forma que `proposeCreateItem`, así que reusa la tarjeta de
  preview —extraída a `ProposedActionCard.tsx`— y el guardado compartido
  (`lib/accionesPropuestas.ts`). "Desde una foto" deshabilitada sin red o con la
  IA apagada, diciendo cuál de las dos. 22 tests nuevos (30 en total en
  `supabase/functions/`). Verificado en claro/oscuro × desktop/375px con el
  harness. Falta la prueba en vivo con fotos reales.

- 2026-07-24 — Service worker: actualización con aviso, no en silencio.
  `registerType` de `autoUpdate` a **`prompt`**; `sw.ts` ganó un listener de
  `message` para `SKIP_WAITING` (sin `skipWaiting()` automático en
  `install`). Nuevo `UpdateBanner.tsx` (hook `useRegisterSW` de
  `virtual:pwa-register/react`) muestra una franja fija al pie con
  Actualizar/Ahora no cuando hay un SW nuevo esperando; montado en `App.tsx`
  fuera de `ProtectedRoute` para que corra también en la pantalla de login.
  `render.yaml` perdió el header de `/registerSW.js` (ese archivo ya no se
  genera — el registro va empaquetado en el bundle, no como script aparte).
  **Verificado en vivo:** build → cambio real → build de nuevo → mismo
  `dist/` servido sin reiniciar el server ni cerrar la pestaña: al pedir
  `registration.update()` aparece el SW nuevo en `waiting`, el banner se
  dibuja (probado en modo oscuro, sobre la pantalla de login), y tocar
  "Actualizar" deja el SW nuevo como `active`/`controller` con la página ya
  recargada sola, sin `waiting` pendiente.
- 2026-07-23 — Rediseño, **Fase 2** (ítem 6 de `PLAN_REDISEÑO.md`): **color
  propio por tema**, la única fase que toca el modelo de datos. Migración
  `temas.color` con paleta cerrada por `CHECK` (siete matices fríos en oklch,
  repartidos cada ~26° entre verde-agua y ciruela, lejos del rust/gold de
  prioridad y del moss de la marca) y backfill que reparte la paleta por orden de
  creación en vez de uniformar. Se guarda el **slug**, no el color: el valor sale
  de los tokens `--color-tema-*`, que se redefinen en modo oscuro — la paleta se
  retoca en CSS sin migrar filas. La migración además le agrega **`updated_at` a
  `temas`**: hasta ahora no se editaban desde la UI y sin columna de tiempo el
  motor de sync no podía resolver conflictos por LWW. Asignación automática (D4)
  en `src/lib/temaColores.ts`, módulo puro con 11 tests: elige entre los colores
  menos usados, descarta el del último tema creado y desempata por hash del
  nombre. El default vive en `repo.createTema()` y no en el form, así que **el
  asistente de IA tampoco crea temas sin color**. El cambio de color pasa por
  `repo.updateTemaColor()` → espejo local + outbox, con guarda LWW: **funciona
  igual sin conexión**. El selector quedó en el `ItemForm`, debajo del select de
  tema (no hay pantalla de "gestionar temas" y no valía inventarla antes de la
  Fase 3): con tema existente guarda al instante, con tema nuevo muestra el color
  propuesto y deja cambiarlo. El punto se ve en los chips de Biblioteca y en los
  encabezados de grupo; no en "Sin tema" ni "Tema eliminado". **Requiere aplicar
  la migración en Supabase antes de desplegar el frontend.**
- 2026-07-23 — Rediseño, Fases 0 y 1 (ítems 1-5 de `PLAN_REDISEÑO.md`): cinco
  tokens nuevos (`card-2`, `ink-mute`, `line-soft`, `moss-tint`, `shadow-float`)
  y **modo oscuro** completo — 14 tokens bajo `:root[data-theme="dark"]`,
  `src/lib/theme.ts` con persistencia en localStorage, script inline en
  `index.html` para evitar el fogonazo claro, y bloque "Apariencia" en Settings.
  Como las utilidades de Tailwind resuelven `var(--color-*)` en render, cambia
  toda la app sin variantes `dark:`. Se eliminaron los tres colores hardcodeados
  que quedaban en `index.css`. **Biblioteca** (`/`, sin cambio de ruta) ganó
  segmented por tipo — incluido `recordatorio`, que existía en el modelo y no se
  podía filtrar —, chips por tema en vez del `<select>`, secciones colapsables y
  el **grupo "Sin tema"**, que la propuesta original omitía y habría hecho
  desaparecer ítems con `tema_id` null. **Recordatorios** pasó de lista plana a
  cuatro grupos (Vencidos · Hoy · Próximos · Hechos) con segmented de filtro y
  lomo por estado; `clasificar()` ganó el estado `hoy`. La **ficha de ítem**
  muestra ahora su recordatorio (campana + fecha, rust si venció) y movió las
  acciones a un pie a la derecha, lo que permitió borrar el media query de 480px.
  Auditoría de contraste: la paleta oscura salió mejor que la clara (2 fallos AA
  contra 6); los de la clara (`gold`, `slate`) son previos y quedaron sin tocar
  como decisión abierta. No se tocaron rutas, `AppNav` ni el asistente: eso es la
  Fase 3, bloqueada por la decisión de si se conserva `react-router`.
- 2026-07-22 — Offline, recordatorios sin conexión (ítem 8 de
  `PLAN_OFFLINE.md`, último del plan): `useLocalReminderWatcher` sondea el
  espejo local (`repo.listRecordatoriosParaDisparo`, que filtra los pendientes
  de la ventana y les une el item desde la caché) en vez de Supabase, así que
  sigue avisando sin conexión con la app abierta; el `marcarEnviado` ya pasaba
  por el repositorio, así que queda encolado y sube al reconectar. Nuevo
  `splitStaleReminders`: los vencidos hace más de 2 min (app cerrada o
  dispositivo dormido) ya no disparan una ráfaga de avisos individuales con
  fecha vieja, se resumen en uno solo ("Tenías N recordatorios vencidos") y se
  marcan enviado — en `/reminders` siguen viéndose como Vencido · ● Notificado
  con su botón Marcar hecho. Para el doble aviso con el cron se implementó el
  dedup por `tag` que anticipaba §6.2 (el cron manda `recordatorio-<id>`, el SW
  lo usa con fallback al tag viejo). 6 tests nuevos (36 en total); verificado en
  la app real con `onLine` simulado y `showNotification` interceptado.
  `send-reminder-notifications` redeployada para que el tag viaje en el payload:
  **versión 2, `ACTIVE`**, `verify_jwt: false` intacto, guard verificado (401 sin
  el secret).
- 2026-07-22 — Offline, indicador de estado (ítems 7 y 9 de `PLAN_OFFLINE.md`):
  el motor pasa a publicar un estado observable (`online`/`running`/`pending`/
  `lastSyncAt`/`error`) que React consume con `useSyncExternalStore`.
  `SyncStatus` pinta una píldora en la nav que solo aparece cuando hay algo que
  decir (sin conexión en slate, error en rust, cola subiendo en gold con el
  punto latiendo, conteo de pendientes), y `SyncSettings` agrega a Settings el
  detalle completo con "última sincronización" y un botón para forzar el ciclo.
  Los errores dejaron de irse solo a la consola: los de red se reportan al
  segundo ciclo fallido seguido, los de sesión vencida desde el primero, y
  `flushOutbox` ahora distingue las ops trabadas por un error permanente (antes
  dejaban el contador clavado sin explicación). El asistente quedó gateado con
  banner + input deshabilitado sin conexión. 3 tests nuevos de `formatHaceCuanto`
  (23 en total); verificado en la app real con sesión de prueba y con el CSS
  compilado en desktop y 375px.
- 2026-07-22 — Offline, escritura completa (ítems 5-6 de `PLAN_OFFLINE.md`):
  `repo.ts` (toda mutación escribe primero el espejo de IndexedDB y encola la op
  en el `outbox`), `syncCore.ts` (lógica pura: plan FIFO con coalescing y
  cancelación insert+delete, LWW condicional, clasificación de errores, backoff)
  y `sync.ts` (flush del outbox con upsert idempotente + escritura condicional
  `updated_at <= client`, reconciliación por re-fetch completo, disparadores
  `online`/foco/visibilidad/intervalo/post-mutación y single-flight con Web
  Locks), montado por `SyncEngine`. Las páginas leen siempre del espejo local y
  releen al terminar cada ciclo; `items.ts`/`temas.ts`/`recordatorios.ts`
  quedaron solo de lectura. El asistente corta con mensaje claro sin red. 20/20
  tests `deno` de la lógica pura + 29 checks de integración contra IndexedDB
  real en el navegador; build y lint sin errores. Falta el indicador visual de
  estado/pendientes (ítem 7).
- 2026-07-22 — Offline, lectura (ítems 1-4 de `PLAN_OFFLINE.md`): UUID generado
  en el cliente en todos los inserts, migración `recordatorios.updated_at` +
  trigger que respeta el `updated_at` del cliente, capa `db.ts` sobre IndexedDB
  (`idb`) con stores versionados, caché read-through en las pantallas y
  `storage.persist()` al iniciar sesión.
- 2026-07-22 — Notificaciones de dos vías: aviso **local instantáneo** cuando la
  app está abierta (`useLocalReminderWatcher` montado en la raíz vía
  `LocalReminderWatcher`, sondeo cada ~25s + `setTimeout` por recordatorio que
  dispara `registration.showNotification` en la `fecha_hora` exacta y marca
  `enviado` directo contra Supabase), con la reconciliación de timers extraída a
  `reminderScheduling.ts` (test `deno`, 7/7). El cron de `pg_cron` bajó de cada
  5 min a **cada 1 min** (`cron.alter_job`, solo el schedule; command/Vault
  intactos) como piso cuando la app está cerrada. Como el aviso local marca
  `enviado` al disparar, el cron ya no reenvía. RemindersPage/AppNav sin cambios
  (ya reflejan `enviado`). Cron verificado por SQL; build OK.
- 2026-07-21 — Deploy: repo subido a GitHub
  (`Raul-coder17/Organizador-IA`, rama `master`) y `render.yaml` para Static
  Site (build `npm run build`, publish `dist`, rewrite SPA `/*→/index.html`,
  no-cache para `sw.js`/`registerSW.js`/`manifest.json`). CORS de las funciones
  browser-facing ya era `*` (sin cambios). Documentados los pasos de Render y la
  nota de que las push se reactivan en el nuevo dominio.
- 2026-07-21 — Asistente con tools ampliadas: `listRecordatorios` (lectura),
  `proposeCreateItem`/`proposeUpdateItem` con soporte de listas (líneas) y
  recordatorios, y **multiacción** (Gemini devuelve varias function calls →
  `acciones_propuestas: []`). Lógica de parseo extraída a `actions.ts` con test
  unitario (8 casos). Frontend: una tarjeta de preview por acción con confirmar/
  cancelar individual + "Confirmar todas". `client_now` para fechas relativas.
  Función redeployada; build y tests OK.
- 2026-07-21 — Fix "Cargando…" pegado en Notificaciones: `navigator.service
  Worker.ready` cuelga (no rechaza) sin SW activo y no había timeout. Se agregó
  `devOptions.enabled` (SW en dev), un `swReadyOrNull()` con timeout de 6s para
  los tres usos de `.ready` en `push.ts`, y un `.catch` en el efecto de montaje
  de `PushSettings`. Verificado con probe: en dev el SW ahora registra y
  `.ready` resuelve; producción intacta.
- 2026-07-21 — Notificaciones push reales para recordatorios: claves VAPID
  (pública en `.env`, privada como secret), migración `push_subscriptions` con
  RLS, service worker propio (`injectManifest`, handlers `push`/
  `notificationclick`), sección "Notificaciones" en Settings (`push.ts` +
  `PushSettings`), Edge Function `send-reminder-notifications` (service_role,
  `npm:web-push`, marca `enviado`, borra suscripciones 410/404, guard por
  `x-cron-secret`, `--no-verify-jwt`), y cron pg_cron cada 5 min vía
  `net.http_post` con el secret en Vault. Indicador "● Notificado" en
  `RemindersPage`. Backend validado en vivo (guard 401/200 + camino DB→función
  200 vía pg_net/Vault); UI verificada en harness (desktop y ~375px). Falta que
  el usuario dé el permiso del navegador y pruebe el ciclo end-to-end.
- 2026-07-21 — Recordatorios (UI + datos, sin push todavía): capa
  `src/lib/recordatorios.ts` (list con join a items, upsert/delete por item,
  marcar hecho, conteo para badge, helpers de fecha), toggle "Agregar
  recordatorio" en `ItemForm` para cualquier tipo de item, pantalla
  `/reminders` con clasificación visual vencido/próximo/hecho (rust/moss/slate)
  y "Marcar hecho", y link + badge rust en `AppNav`. Build sin errores; visual
  verificado en desktop y ~375px con el harness de CSS compilado. Prueba en
  vivo (crear con fecha pasada, marcar hecho) pendiente del lado del usuario.
- 2026-07-21 — Listas con checkboxes reales: nuevo contenido
  `{ items: [{id,texto,hecho}] }`, editor de líneas en el form, checkboxes
  persistidos con UI optimista + revert on error, y compat con listas viejas
  `{ texto }`. Antes: render de `<table>` real para items tipo tabla,
  incluyendo texto con pipes/markdown.
- 2026-07-21 — Rediseño visual completo (sistema de fichas de catálogo) en
  toda la app: tokens de color + Fraunces/IBM Plex (Tailwind v4 `@theme`),
  nav y labels en mono, ítems con borde de prioridad, encabezados de tema con
  hairline, botones moss, y render de `<table>` real para items tipo tabla
  (con `overflow-x`). Responsivo verificado en desktop y ~375px (AuthPage en
  la app real + harness con el CSS compilado para las pantallas logueadas).

- 2026-07-21 — Rate limits adaptativos de Gemini: se aprende la cuota diaria
  real del body del 429 (`quotaValue`) en `user_ai_settings.daily_quota_learned`,
  contador `ai_usage` por usuario/día (día en hora del Pacífico) con RPCs
  atómicas, pre-flight que evita llamar a Gemini si ya se agotó la cuota, y
  cuenta regresiva en el frontend para rate limits por minuto (usa el
  `retryDelay` real). `parseRateLimit` verificado con test unitario (4 casos
  con la forma real del 429). Función `ACTIVE` v6.

- 2026-07-21 — Errores de Gemini traducidos al español en `ai-assistant`
  (`translateGeminiError` + `GeminiError`): 429/cuota, 400/key inválida,
  403/sin acceso, 500-503/servicio caído, y genérico con status para el
  resto; nunca se muestra el JSON crudo al usuario, que sí se sigue
  logueando. Frontend muestra el mensaje ya traducido. Verificado con test
  unitario del clasificador (8 casos) + función `ACTIVE` v5.
- 2026-07-21 — Fix: candidate de Gemini sin `parts` (root cause del 502 en
  `/assistant`). Guarda defensiva en el loop de `ai-assistant` (responde
  200 con mensaje según `finishReason` en vez de romper con `TypeError`) +
  `generationConfig` con `thinkingBudget: 0` y `maxOutputTokens: 2048` para
  que el thinking de 2.5-flash no consuma todo el budget (MAX_TOKENS).
  Se dejó `console.error` del candidate completo para diagnóstico futuro.
- 2026-07-21 — Instrumentación temporal para ver el error real de Gemini:
  el frontend lee `error.context` (body del 502) en vez del mensaje
  genérico de `supabase-js`, y `ai-assistant` loguea status + body crudo de
  Gemini. Permitió confirmar el `TypeError` de `parts`.
- 2026-07-21 — Fix: modelo de Gemini actualizado de `gemini-2.0-flash` a
  `gemini-2.5-flash` en la Edge Function `ai-assistant`, porque
  `gemini-2.0-flash` se retiró el 1 de junio de 2026. Redeploy `--use-api`
  (versión 2, `ACTIVE`); sin cambios de build.
- 2026-07-21 — Asistente de IA con function-calling (solo texto): Edge
  Function `ai-assistant` (guard de `ai_enabled`, descifra la key, Gemini
  con tools; `listItems` server-side, `propose*` devueltas para
  confirmar), pantalla `/assistant` con chat y tarjeta de preview
  Confirmar/Cancelar que ejecuta el cambio reusando el CRUD manual, y
  gating del link en `AppNav` según `ai_enabled`. Desplegada al proyecto
  real. Prueba end-to-end conversacional: pendiente de que el usuario la
  corra con su cuenta.

- 2026-07-21 — Verificado en vivo: la key real de Gemini que Raúl guardó
  desde `/settings` quedó cifrada en `user_ai_settings`
  (`gemini_api_key_encrypted` es un blob `base64(iv).base64(ciphertext)`
  ilegible, no texto plano) y `ai_enabled = true`.
- 2026-07-21 — Settings de IA: tabla `user_ai_settings` con RLS, Edge
  Function `manage-ai-key` (valida contra Gemini, cifra con AES-256-GCM,
  nunca devuelve la key), pantalla `/settings` con `react-router-dom`.
  Migración aplicada y función desplegada al proyecto real; secret
  `AI_KEY_ENCRYPTION_SECRET` generado y seteado. Cifrado en vivo con una
  key real: pendiente de que el usuario la cargue una vez.
- 2026-07-21 — Auth (email/password) + CRUD manual de items y temas.
  Componentes: `AuthContext`, `AuthPage`, `ProtectedRoute`, `ItemForm`,
  `ItemList`, `ItemsPage`. RLS verificado estructuralmente en vivo;
  prueba end-to-end con 2 usuarios pendiente (requiere que el usuario
  cree las cuentas de test).
- 2026-07-21 — Migración inicial aplicada al proyecto Supabase real
  (`uesnorbrpeosynabobha`) y validada en vivo: 3 tablas con RLS activo
  (4 policies c/u). CLI de Supabase agregado como devDependency.
- 2026-07-20 — Schema inicial (`temas`, `items`, `recordatorios`) con RLS,
  triggers de `updated_at` e índices. Tipos TypeScript en
  `src/types/database.ts`. Proyecto Supabase real: pendiente de crear.
