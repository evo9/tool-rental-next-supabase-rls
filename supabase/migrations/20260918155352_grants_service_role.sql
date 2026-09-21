-- service_role: сид-скрипт (scripts/seed-staff.ts) создаёт первого
-- SUPERADMIN, пока ни один пользователь не проходит политику insert.
-- BYPASSRLS отключает только политики, привилегии на таблицу нужны.
-- Сид делает upsert = INSERT ... ON CONFLICT (user_id) DO UPDATE:
--   insert - первый запуск, update - повторный (Postgres требует UPDATE
--   для любого ON CONFLICT DO UPDATE, даже без конфликта).
-- delete не выдан: сид ничего не удаляет.
grant insert, update on public.staff to service_role;