-- Schema inicial: temas, items, recordatorios
-- Multi-usuario desde el inicio: RLS habilitado en las 3 tablas,
-- cada usuario solo ve/edita sus propios datos vía auth.uid().

create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- Tablas
-- ============================================================

create table temas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tema_id uuid references temas (id) on delete set null,
  tipo text not null check (tipo in ('nota', 'recordatorio', 'lista', 'tabla')),
  prioridad text check (prioridad in ('alta', 'media', 'baja')),
  contenido jsonb not null,
  origen text check (origen in ('texto', 'foto', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recordatorios (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  fecha_hora timestamptz not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'hecho')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Trigger updated_at (items)
-- ============================================================

create function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger items_set_updated_at
  before update on items
  for each row
  execute function set_updated_at();

-- ============================================================
-- Índices
-- ============================================================

create index items_user_id_tema_id_idx on items (user_id, tema_id);
create index items_user_id_tipo_idx on items (user_id, tipo);
create index recordatorios_fecha_hora_idx on recordatorios (fecha_hora);

-- ============================================================
-- RLS: temas
-- ============================================================

alter table temas enable row level security;

create policy "temas_select_own"
  on temas for select
  using (user_id = auth.uid());

create policy "temas_insert_own"
  on temas for insert
  with check (user_id = auth.uid());

create policy "temas_update_own"
  on temas for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "temas_delete_own"
  on temas for delete
  using (user_id = auth.uid());

-- ============================================================
-- RLS: items
-- ============================================================

alter table items enable row level security;

create policy "items_select_own"
  on items for select
  using (user_id = auth.uid());

create policy "items_insert_own"
  on items for insert
  with check (user_id = auth.uid());

create policy "items_update_own"
  on items for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "items_delete_own"
  on items for delete
  using (user_id = auth.uid());

-- ============================================================
-- RLS: recordatorios (sin user_id propio, se valida vía items)
-- ============================================================

alter table recordatorios enable row level security;

create policy "recordatorios_select_own"
  on recordatorios for select
  using (
    exists (
      select 1 from items
      where items.id = recordatorios.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "recordatorios_insert_own"
  on recordatorios for insert
  with check (
    exists (
      select 1 from items
      where items.id = recordatorios.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "recordatorios_update_own"
  on recordatorios for update
  using (
    exists (
      select 1 from items
      where items.id = recordatorios.item_id
        and items.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from items
      where items.id = recordatorios.item_id
        and items.user_id = auth.uid()
    )
  );

create policy "recordatorios_delete_own"
  on recordatorios for delete
  using (
    exists (
      select 1 from items
      where items.id = recordatorios.item_id
        and items.user_id = auth.uid()
    )
  );
