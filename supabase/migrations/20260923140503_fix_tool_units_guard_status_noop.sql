-- =====================================================================
-- Исправление tool_units_guard_status: no-op UPDATE статуса
--
-- Что делает: переопределяет public.tool_units_guard_status()
--   (create or replace function - идемпотентно, безопасно переприменять).
--
-- Зависит от: 20260923120539_tool_units_and_rentals.sql (исходное
--   определение функции и триггера).
--
-- Зачем: "before update of status" срабатывает, как только status
--   присутствует в SET, независимо от того, отличается ли новое
--   значение от старого - см. docs/book/04-rentals.md, "Новая механика",
--   и главу 03, комментарий к customers_guard_category про ту же
--   особенность у update of category.
--   npm run seed:staff делает upsert по tool_units.inventory_number
--   (ON CONFLICT DO UPDATE по всем колонкам payload, включая status).
--   Второй прогон сида посылает то же значение status, что уже стоит в
--   строке, - формально это no-op, но триггер всё равно срабатывает.
--   Первая проверка функции ("WRITTEN_OFF - конечный статус") этого не
--   учитывала: она запрещала любой UPDATE ... SET status = ... для уже
--   списанной единицы, включая запись того же самого значения, и сид
--   падал на первой же WRITTEN_OFF-единице при повторном запуске
--   (P0001 "a written off unit cannot change status" там, где реального
--   изменения не было).
--   Исправление - is distinct from: терминальность проверяется только
--   при настоящей попытке сменить значение, тем же приёмом, что и
--   distinct from в customers_guard_category (этап 3) для "поле
--   действительно изменилось".
--
-- Как проверить:
--   npm run seed:staff - два прогона подряд без ошибок.
--   tests/policies/04_rentals.sql - должен по-прежнему проходить целиком
--     (терминальность WRITTEN_OFF при настоящей попытке сменить статус
--     проверяется этим тестом и не должна была сломаться).
-- =====================================================================

create or replace function public.tool_units_guard_status()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
as $$
declare
  v_has_active_position boolean;
begin
  if old.status = 'WRITTEN_OFF' and new.status is distinct from old.status then
    raise exception 'a written off unit cannot change status'
      using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.rental_items ri
    where ri.tool_unit_id = old.id and ri.returned_at is null
  ) into v_has_active_position;

  if new.status = 'RENTED' and not v_has_active_position then
    raise exception 'unit cannot become RENTED without an active rental item'
      using errcode = 'P0001';
  end if;

  if old.status = 'RENTED' and new.status <> 'RENTED' and v_has_active_position then
    raise exception 'unit still has an active rental item'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
