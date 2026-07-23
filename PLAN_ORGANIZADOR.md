# Organizador Personal IA

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
> Ítems 1-7, 9 y 10 implementados (lectura y escritura offline con
> sincronización automática e indicador de estado). Falta el ítem 8:
> recordatorios que disparen sin conexión.

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
  pendientes (`where fecha_hora <= now()`).

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
  navegándola a `/reminders`, o abre una nueva). El registro del SW lo sigue
  auto-inyectando el plugin (`registerSW.js`).
- Tipado: `src/sw.ts` se excluye de `tsconfig.app.json` (lib DOM) y se compila
  con `tsconfig.worker.json` (lib WebWorker), referenciado desde
  `tsconfig.json`, así `tsc -b` valida el worker sin chocar con el DOM.

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

### Asistente sin conexión (ítem 9)

Necesita a Gemini vía Edge Function, así que queda **bloqueado** offline con un
estado explícito: banner con borde rust arriba del chat, input y botón
deshabilitados con placeholder que lo explica, y la guarda de `navigator.onLine`
en el envío como red de seguridad si la señal se cae entre escribir y mandar.
Las acciones que **sí** confirma el usuario pasan por el repositorio, así que un
corte entre proponer y confirmar no pierde el cambio.

### Verificación

- **23/23 tests unitarios** de la lógica pura (`npx deno test
  src/lib/syncCore.test.ts`): orden FIFO y dependencias, coalescing,
  cancelación insert+delete y el matiz del ack perdido, idempotencia al
  replanificar tras un fallo, los tres desenlaces del LWW condicional,
  clasificación de errores, backoff y el formateo de "hace cuánto".
- **Harness de integración en el navegador** (build de producción, temporal):
  29 checks contra IndexedDB real ejercitando `db.ts` + `repo.ts` + `syncCore.ts`
  sin red — crear/editar/borrar deja el espejo y el outbox como corresponde, el
  plan sale en orden causal, el `baseUpdatedAt` y el `updated_at` del update son
  los correctos, y el badge de recordatorios sale del espejo local.
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
