-- Settings de IA por usuario: la API key de Gemini nunca se guarda en
-- texto plano (se cifra en la Edge Function `manage-ai-key` antes del
-- insert/update) ni se guarda en el navegador.

create table user_ai_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  gemini_api_key_encrypted text,
  ai_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger user_ai_settings_set_updated_at
  before update on user_ai_settings
  for each row
  execute function set_updated_at();

-- ============================================================
-- RLS: user_ai_settings
-- ============================================================

alter table user_ai_settings enable row level security;

create policy "user_ai_settings_select_own"
  on user_ai_settings for select
  using (user_id = auth.uid());

create policy "user_ai_settings_insert_own"
  on user_ai_settings for insert
  with check (user_id = auth.uid());

create policy "user_ai_settings_update_own"
  on user_ai_settings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_ai_settings_delete_own"
  on user_ai_settings for delete
  using (user_id = auth.uid());
