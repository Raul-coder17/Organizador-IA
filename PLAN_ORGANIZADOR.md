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

## Changelog

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
