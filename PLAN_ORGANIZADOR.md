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

## Changelog

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
