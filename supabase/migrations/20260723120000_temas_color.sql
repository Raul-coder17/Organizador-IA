-- Color por tema (PLAN_REDISEÑO.md ítem 6, Fase 2)
--
-- Segunda dimensión de color del sistema visual: la PRIORIDAD ya vive en el
-- lomo cálido de la ficha (rust/gold/slate); el TEMA pasa a vivir en un punto
-- frío. Nunca se mezclan (ver la regla en src/index.css).
--
-- Lo que se guarda acá es el SLUG del color, no el color en sí: así el mismo
-- tema puede resolverse a un tono más claro en modo oscuro (los tokens
-- --color-tema-* se redefinen en CSS) sin tener que migrar datos nunca más.
--
-- 1) `temas.color`, con CHECK contra la paleta fría acotada + backfill rotando
--    la paleta por usuario, así los temas que ya existen no salen todos iguales.
-- 2) `temas.updated_at`: hasta ahora los temas no se editaban desde la UI y no
--    hacía falta. Con el selector de color sí se editan, y sin columna de
--    tiempo el motor de sync no puede resolver conflictos por LWW (§4.3 de
--    PLAN_OFFLINE.md) — dos dispositivos cambiando el color offline resolvían
--    por orden de llegada.

-- ============================================================
-- 1) Columna color + paleta acotada
-- ============================================================

alter table temas
  add column color text not null default 'azul';

alter table temas
  add constraint temas_color_check
  check (color in ('verde-agua', 'turquesa', 'celeste', 'azul', 'indigo', 'violeta', 'ciruela'));

-- Backfill: en vez de dejar todos los temas existentes en el default, se les
-- reparte la paleta rotando por orden de creación dentro de cada usuario (el
-- mismo criterio que usa el cliente al crear temas nuevos).
with paleta as (
  select array['verde-agua', 'turquesa', 'celeste', 'azul', 'indigo', 'violeta', 'ciruela'] as colores
),
numerados as (
  select id, row_number() over (partition by user_id order by created_at, id) - 1 as n
  from temas
)
update temas t
set color = p.colores[(n.n % array_length(p.colores, 1)) + 1]
from numerados n, paleta p
where t.id = n.id;

-- ============================================================
-- 2) updated_at + trigger (LWW al sincronizar)
-- ============================================================

alter table temas
  add column updated_at timestamptz not null default now();

-- Las filas existentes toman su created_at (no el now() de la migración): un
-- cambio de color hecho offline antes de esto no debería perder contra la fecha
-- en que se corrió la migración.
update temas set updated_at = created_at;

-- Misma función que items/recordatorios: respeta el updated_at que mande el
-- cliente (lo necesita el motor de sync) y estampa now() cuando no lo tocó.
create trigger temas_set_updated_at
  before update on temas
  for each row
  execute function set_updated_at();
