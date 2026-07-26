-- Recordatorios recurrentes
--
-- Hasta acá un recordatorio era de UNA sola vez: se disparaba (o lo marcaban
-- hecho) y quedaba así para siempre. Con esta columna un recordatorio puede
-- repetirse: al marcarse 'enviado' o 'hecho', en vez de quedar en ese estado,
-- se le recalcula `fecha_hora` a la próxima vuelta y vuelve a 'pendiente'.
--
-- `null` = no se repite, que es exactamente lo que tienen hoy TODAS las filas
-- existentes. Por eso la columna es nullable y sin default: nada cambia de
-- comportamiento para lo ya creado, y no hace falta backfill.
--
-- No hay columna de fecha de fin en esta versión: para terminar una recurrencia
-- el usuario edita el item y elige "No se repite", o borra el item.

alter table recordatorios
  add column recurrencia text check (recurrencia in ('diario', 'semanal', 'mensual'));

comment on column recordatorios.recurrencia is
  'null = una sola vez. diario/semanal/mensual = al marcarse enviado o hecho, '
  'avanza fecha_hora a la próxima ocurrencia y vuelve a estado pendiente.';
