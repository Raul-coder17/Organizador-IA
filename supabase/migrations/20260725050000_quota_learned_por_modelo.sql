-- La cuota diaria aprendida queda atada al MODELO con el que se aprendió.
--
-- El bug: `daily_quota_learned` se aprende del 429 real de Gemini (ver
-- 20260721163051_ai_usage.sql), pero no guardaba CONTRA QUÉ MODELO. Al cambiar
-- de `gemini-2.5-flash` a `gemini-3.1-flash-lite`, el valor viejo (20, que era
-- el RPD real del modelo anterior) seguía usándose en el pre-flight y habría
-- cortado al usuario en 20 aunque el modelo nuevo tenga otro límite — sin
-- ninguna forma de que el sistema se diera cuenta solo.
--
-- El fix es que el valor aprendido valga SÓLO para el modelo bajo el que se
-- aprendió. La Edge Function compara esta columna contra su constante
-- GEMINI_MODEL: si no coinciden, trata la cuota como desconocida y vuelve a
-- aprenderla del primer 429 real del modelo nuevo. Así el próximo cambio de
-- modelo se auto-corrige y no hay que acordarse de resetear nada a mano.

alter table user_ai_settings
  add column daily_quota_learned_model text;

-- Reset del valor actual: lo que hay guardado hoy se aprendió bajo
-- gemini-2.5-flash y no aplica al modelo nuevo. Se pone en null (junto con la
-- columna nueva, que arranca en null) para que el sistema lo reaprenda desde
-- cero. NO se toca `ai_usage`: el contador de requests de hoy es correcto y
-- sigue contando igual — lo que se resetea es el LÍMITE, no el uso.
update user_ai_settings
   set daily_quota_learned = null,
       daily_quota_learned_model = null
 where daily_quota_learned is not null;

comment on column user_ai_settings.daily_quota_learned is
  'RPD real aprendido del 429 de Gemini. Válido sólo para el modelo indicado en daily_quota_learned_model.';
comment on column user_ai_settings.daily_quota_learned_model is
  'Modelo bajo el que se aprendió daily_quota_learned. Si no coincide con el modelo actual de la Edge Function, el valor se ignora y se reaprende.';
