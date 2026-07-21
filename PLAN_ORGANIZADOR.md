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

## Changelog

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
