-- Rate limiting adaptativo de la IA.
--
-- El límite diario real de Gemini (free tier) varía por proyecto/modelo y ya
-- cambió una vez, así que NO se hardcodea: se aprende del propio 429
-- (quotaValue) y se guarda en user_ai_settings.daily_quota_learned. El
-- contador de uso diario vive en ai_usage, con el día calculado en
-- America/Los_Angeles para que coincida con el reset de cuota de Gemini
-- (medianoche hora del Pacífico).

alter table user_ai_settings
  add column daily_quota_learned integer;

create table ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  fecha date not null,
  requests integer not null default 0,
  primary key (user_id, fecha)
);

alter table ai_usage enable row level security;

create policy "ai_usage_select_own"
  on ai_usage for select
  using (user_id = auth.uid());

create policy "ai_usage_insert_own"
  on ai_usage for insert
  with check (user_id = auth.uid());

create policy "ai_usage_update_own"
  on ai_usage for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Incremento atómico del contador de hoy; devuelve el nuevo total.
-- security invoker => corre con el rol del usuario y respeta RLS.
create or replace function increment_ai_usage()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  hoy date := (now() at time zone 'America/Los_Angeles')::date;
  nuevo integer;
begin
  insert into ai_usage (user_id, fecha, requests)
    values (auth.uid(), hoy, 1)
  on conflict (user_id, fecha)
    do update set requests = ai_usage.requests + 1
  returning requests into nuevo;
  return nuevo;
end;
$$;

-- Lectura del contador de hoy (0 si no hay fila).
create or replace function ai_usage_today()
returns integer
language sql
security invoker
set search_path = public
as $$
  select coalesce(
    (select requests
       from ai_usage
      where user_id = auth.uid()
        and fecha = (now() at time zone 'America/Los_Angeles')::date),
    0);
$$;

grant execute on function increment_ai_usage() to authenticated;
grant execute on function ai_usage_today() to authenticated;
