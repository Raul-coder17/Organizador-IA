-- Recurrencia por días específicos de la semana
--
-- Cuarto tipo de recurrencia: 'dias_semana' (ej. lunes, miércoles y viernes).
-- Es distinto de 'semanal', que solo suma 7 días desde la última vez y por lo
-- tanto cae siempre en UN mismo día.
--
-- ============================================================
-- CONVENCIÓN DE `recurrencia_dias` — leer antes de tocar nada
-- ============================================================
--
-- Enteros 0-6, donde 0 = domingo, 1 = lunes, … 6 = sábado. Es la misma escala
-- que devuelve `Date.prototype.getUTCDay()` en JavaScript, y eso NO es
-- casualidad: el cálculo de la próxima ocurrencia corre en dos runtimes
-- distintos (el navegador y la Edge Function del cron) y los dos tienen que dar
-- el mismo resultado, así que toda la aritmética de fechas del proyecto es en
-- UTC.
--
-- Por eso, y esto es lo que hay que tener presente: los días guardados acá son
-- los días de la semana **en UTC**, no en la zona horaria del usuario.
--
-- Para la zona de esta app (Argentina, UTC-3) los dos coinciden en casi todo el
-- día, pero NO entre las 21:00 y las 23:59 locales, que ya son el día siguiente
-- en UTC. Un "los lunes a las 22" se guarda como fecha_hora del martes 01:00 UTC
-- y recurrencia_dias = {2} (martes UTC), y al mostrarlo la app lo vuelve a
-- traducir a "lunes". Esa conversión la hace el cliente, que es el único que
-- conoce la zona; el servidor nunca la necesita.
--
-- INVARIANTE que mantiene el cliente: el día UTC de `fecha_hora` siempre es uno
-- de los de `recurrencia_dias`. El form "engancha" la primera fecha al próximo
-- día marcado para que así sea.
--
-- ============================================================
-- NOTA: esta migración es IDEMPOTENTE
-- ============================================================
--
-- Todo va con `if exists` / `if not exists` / `or replace`. El primer intento de
-- aplicarla falló a mitad de camino (un CHECK con subquery, que Postgres no
-- acepta), y aunque quedó sin registrarse, no valía la pena depender de que el
-- rollback hubiera sido perfecto: así se puede re-correr sin miedo en cualquier
-- estado intermedio.

-- ============================================================
-- 1) `recurrencia` acepta el valor nuevo
-- ============================================================

-- El check de la migración anterior se creó sin nombre explícito, así que
-- Postgres lo llamó `recordatorios_recurrencia_check`. Se reemplaza para sumar
-- 'dias_semana' sin tocar los tres valores que ya existían.
alter table recordatorios
  drop constraint if exists recordatorios_recurrencia_check;

alter table recordatorios
  add constraint recordatorios_recurrencia_check
  check (recurrencia in ('diario', 'semanal', 'mensual', 'dias_semana'));

-- ============================================================
-- 2) Qué días
-- ============================================================

alter table recordatorios
  add column if not exists recurrencia_dias smallint[];

-- Validación de los días en una función y no inline en el CHECK porque hace
-- falta `unnest` para detectar repetidos, y Postgres NO permite subqueries
-- dentro de un check constraint (error 0A000). Una función `immutable` que solo
-- mira su argumento sí se puede llamar desde un check, y además deja la regla
-- con nombre y testeable a mano:
--
--   select dias_semana_validos(array[1,3,5]::smallint[]);  -- t
--   select dias_semana_validos(array[1,1,3]::smallint[]);  -- f (repetido)
--   select dias_semana_validos(array[7]::smallint[]);      -- f (fuera de rango)
--   select dias_semana_validos(array[]::smallint[]);       -- f (vacío)
create or replace function public.dias_semana_validos(dias smallint[])
returns boolean
language sql
immutable
strict
as $$
  select cardinality(dias) between 1 and 7
     and dias <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
     -- Sin repetidos: {1,1,3} pasaría el rango y la cantidad, pero no es un
     -- conjunto de días válido.
     and cardinality(dias) = (select count(distinct d) from unnest(dias) as d)
$$;

comment on function public.dias_semana_validos(smallint[]) is
  'Valida recordatorios.recurrencia_dias: 1 a 7 días, todos entre 0 y 6, sin repetidos.';

alter table recordatorios
  drop constraint if exists recordatorios_recurrencia_dias_validos;

alter table recordatorios
  add constraint recordatorios_recurrencia_dias_validos
  check (recurrencia_dias is null or public.dias_semana_validos(recurrencia_dias));

-- Coherencia entre las dos columnas: los días existen SI Y SOLO SI la
-- recurrencia es 'dias_semana'. Sin esto podrían quedar días huérfanos de un
-- recordatorio que pasó a 'diario' (y que volverían a aplicarse si alguien lo
-- devolviera a 'dias_semana' sin querer), o un 'dias_semana' sin días, que no
-- se puede calcular.
--
-- `is not distinct from` en vez de `=` porque `recurrencia` es nullable: con `=`
-- la comparación daría NULL para los recordatorios de una sola vez y el check
-- pasaría por accidente en vez de por decisión.
alter table recordatorios
  drop constraint if exists recordatorios_dias_solo_si_dias_semana;

alter table recordatorios
  add constraint recordatorios_dias_solo_si_dias_semana
  check (
    (recurrencia is not distinct from 'dias_semana') = (recurrencia_dias is not null)
  );

comment on column recordatorios.recurrencia_dias is
  'Solo para recurrencia = ''dias_semana''. Días de la semana EN UTC (0=domingo … '
  '6=sábado, escala de getUTCDay()), no en la zona del usuario: el cliente '
  'convierte. El día UTC de fecha_hora siempre es uno de estos.';
