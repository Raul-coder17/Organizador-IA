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

Todavía **no hay proyecto de Supabase creado/linkeado** (requiere una
cuenta — paso pendiente del lado humano, Code no puede crearlo).
Una vez exista:

1. `npx supabase login` y `npx supabase link --project-ref <ref>`.
2. `npx supabase db push` — aplica todas las migraciones de
   `supabase/migrations/` al proyecto remoto.
3. Alternativa sin CLI: pegar el contenido del archivo `.sql` en el
   SQL Editor del dashboard de Supabase y ejecutarlo una vez.
4. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env`
   (a partir de `.env.example`) con las credenciales del proyecto.

## Changelog

- 2026-07-20 — Schema inicial (`temas`, `items`, `recordatorios`) con RLS,
  triggers de `updated_at` e índices. Tipos TypeScript en
  `src/types/database.ts`. Proyecto Supabase real: pendiente de crear.
