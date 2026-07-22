-- Suscripciones Web Push por usuario. Cada navegador/dispositivo que activa
-- las notificaciones guarda acá su endpoint + claves. La Edge Function
-- `send-reminder-notifications` (que corre server-side con service_role) lee
-- estas filas para disparar las notificaciones y borra las que expiran (410/404).

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- El cron/función busca las suscripciones por usuario dueño del item.
create index push_subscriptions_user_id_idx on push_subscriptions (user_id);

-- ============================================================
-- RLS: push_subscriptions (scopeada al dueño; el service_role la bypassa)
-- ============================================================

alter table push_subscriptions enable row level security;

create policy "push_subscriptions_select_own"
  on push_subscriptions for select
  using (user_id = auth.uid());

create policy "push_subscriptions_insert_own"
  on push_subscriptions for insert
  with check (user_id = auth.uid());

create policy "push_subscriptions_update_own"
  on push_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push_subscriptions_delete_own"
  on push_subscriptions for delete
  using (user_id = auth.uid());
