-- Freno proactivo de RPM (rate limit por minuto) para la IA.
--
-- La auditoría previa (ver PLAN_ORGANIZADOR.md) confirmó que ai_usage sólo
-- rastrea el límite DIARIO: nada protegía contra el límite por minuto (RPM),
-- que con este modelo/cuenta es bajo. Antes, un 429 "por minuto" recién se
-- detectaba DESPUÉS de gastar la llamada. Esta tabla guarda una marca de
-- tiempo por cada llamada real a Gemini (de cualquiera de las dos Edge
-- Functions: comparten modelo y cuenta, así que comparten RPM), para que el
-- servidor pueda contar cuántas hubo en los últimos 60 segundos ANTES de
-- intentar la siguiente y frenar sin gastarla si ya no hay lugar.
--
-- A diferencia de daily_quota_learned, el RPM no se "aprende": se hardcodea
-- en cada Edge Function (GEMINI_RPM) porque no hay una forma confiable de
-- derivarlo de un 429 con esta granularidad. Esta tabla sólo guarda el
-- historial de marcas; la decisión (permitir/bloquear + cuánto esperar) es
-- lógica pura en rpm.ts (decideRpmSlot), testeada con `deno test`.

create table ai_call_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  called_at timestamptz not null default now()
);

create index ai_call_log_user_called_idx on ai_call_log (user_id, called_at desc);

alter table ai_call_log enable row level security;

create policy "ai_call_log_select_own"
  on ai_call_log for select
  using (user_id = auth.uid());

create policy "ai_call_log_insert_own"
  on ai_call_log for insert
  with check (user_id = auth.uid());

-- La Edge Function poda sus propias marcas más viejas que la ventana en cada
-- chequeo (ver reserveRpmSlot en index.ts), así la tabla no crece sin límite
-- con el uso normal.
create policy "ai_call_log_delete_own"
  on ai_call_log for delete
  using (user_id = auth.uid());
