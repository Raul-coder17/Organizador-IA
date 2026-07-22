-- Soporte offline (ítem 2 de PLAN_OFFLINE.md §3.4)
--
-- 1) `recordatorios` gana `updated_at` (antes no lo tenía) para poder resolver
--    conflictos con "gana el más reciente" (LWW por updated_at) al sincronizar.
-- 2) El trigger de `updated_at` pasa a RESPETAR el updated_at que mande el
--    cliente: solo lo pisa con now() si el cliente NO lo cambió. Así el camino
--    normal (online) sigue estampando now() en cada UPDATE, pero el camino de
--    sync podrá mandar su propio timestamp (el del momento real de edición
--    offline) sin que el trigger lo sobrescriba.

-- ============================================================
-- 1) Columna updated_at en recordatorios + backfill
-- ============================================================

alter table recordatorios
  add column updated_at timestamptz not null default now();

-- Backfill: las filas existentes toman su created_at como updated_at inicial
-- (en vez del now() del default, que sería la fecha de la migración).
update recordatorios set updated_at = created_at;

-- ============================================================
-- 2) Trigger updated_at que respeta el valor del cliente
-- ============================================================

-- Reemplaza el cuerpo de la función existente (la usa items desde el schema
-- inicial). Nuevo criterio: si el cliente no tocó updated_at (queda igual al
-- valor viejo de la fila), estampamos now(); si lo mandó explícito y distinto,
-- lo dejamos tal cual (lo necesita el motor de sync para LWW por tiempo real).
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

-- El trigger de items ya existe (items_set_updated_at) y usa esta misma función,
-- así que hereda el nuevo comportamiento sin recrearlo.

-- Trigger equivalente para recordatorios.
create trigger recordatorios_set_updated_at
  before update on recordatorios
  for each row
  execute function set_updated_at();
