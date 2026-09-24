-- =====================================================================
-- Ручная проверка этапа 8: вернуть политику, сломанную break-policy.sql.
--
-- Что делает:
--   Пересоздаёт политику "tools: manager+ inserts" на public.tools в
--   исходном виде. Текст скопирован из миграции
--   supabase/migrations/20260918094510_staff_and_roles.sql (раздел 5).
--   Идемпотентен: drop policy if exists + create policy, можно запускать
--   повторно, в том числе когда политика и так цела.
--
-- Как использовать:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/manual/restore-policy.sql
--   затем npm run test:api - без расхождений.
-- =====================================================================

drop policy if exists "tools: manager+ inserts" on public.tools;

-- INSERT, MANAGER и выше (сравнение по порядку enum).
-- Негатив: OPERATOR, insert -> ошибка 42501.
create policy "tools: manager+ inserts"
on public.tools for insert
to authenticated
with check ((select public.current_staff_role()) >= 'MANAGER');
