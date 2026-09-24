-- =====================================================================
-- Этап 8: удаление единиц (tool_units). Регрессия к находке матрицы прав:
-- в миграции этапа 4 была политика DELETE, а гранта DELETE не было, и
-- политика ни разу не срабатывала (см. 20260924051050_grant_delete_tool_units.sql).
--
-- Предусловия: миграции этапов 1-8 применены, npm run seed:staff
--   выполнен (operator@example.com, manager@example.com, admin@example.com).
-- Запуск:
--   SQL Editor: вставить целиком, Run. Провал останавливает скрипт с FAIL.
--   psql "$DB_URL" -f tests/policies/08_tool_units_delete.sql
-- В базе ничего не остаётся: всё внутри транзакции с ROLLBACK.
-- =====================================================================
begin;

create function pg_temp.act_as(p_email text) returns void
    language plpgsql as $$
declare v_uid uuid;
begin
  reset role;
  select id into strict v_uid from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.act_as_anon() returns void
    language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $$;

create function pg_temp.expect_affected(p_query text, p_expected bigint) returns void
    language plpgsql as $$
declare v bigint;
begin
  execute p_query;
  get diagnostics v = row_count;
  if v <> p_expected then
    raise exception 'FAIL: ожидалось затронуто %, затронуто %: %', p_expected, v, p_query;
  end if;
  raise notice 'ok [затронуто %] %', v, p_query;
end $$;

create function pg_temp.expect_error(p_query text, p_code text default '42501') returns void
    language plpgsql as $$
begin
  begin
    execute p_query;
  exception when others then
    if sqlstate = p_code then
      raise notice 'ok [ошибка %] %', sqlstate, p_query;
      return;
    end if;
    raise exception 'FAIL: ожидалась ошибка %, получена % (%): %',
      p_code, sqlstate, sqlerrm, p_query;
  end;
  raise exception 'FAIL: ожидалась ошибка %, запрос прошёл: %', p_code, p_query;
end $$;

-- --- фикстуры (postgres, мимо RLS) ------------------------------------
-- D1 и D2 - свободные единицы; D3 - единица, которую выдавали и вернули
-- (в истории аренд остаётся строка rental_items).
insert into public.tools (id, name, daily_rate, deposit_value) values
  ('00000000-0000-0000-0000-0000000008f0', '__Test Delete', 100, 1000);

insert into public.tool_units (id, tool_id, inventory_number) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008f0', '__DEL-1'),
  ('00000000-0000-0000-0000-0000000008a2', '00000000-0000-0000-0000-0000000008f0', '__DEL-2'),
  ('00000000-0000-0000-0000-0000000008a3', '00000000-0000-0000-0000-0000000008f0', '__DEL-3');

insert into public.customers (id, full_name, phone) values
  ('00000000-0000-0000-0000-0000000008c1', 'Тест Клиент Удаление', '+380000000811');

insert into public.rentals (id, customer_id, created_by, issued_at, planned_return_at) values
  ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008c1',
   (select id from auth.users where email = 'operator@example.com'),
   now(), now() + interval '1 day');

insert into public.rental_items (id, rental_id, tool_unit_id) values
  ('00000000-0000-0000-0000-0000000008d1', '00000000-0000-0000-0000-0000000008b1',
   '00000000-0000-0000-0000-0000000008a3');

update public.rental_items
set return_photo_path = '00000000-0000-0000-0000-0000000008b1/00000000-0000-0000-0000-0000000008d1/return-test.jpg',
    returned_at = now()
where id = '00000000-0000-0000-0000-0000000008d1';

-- ---------------------------------------------------------------------
-- OPERATOR
-- ---------------------------------------------------------------------
select pg_temp.act_as('operator@example.com');

-- негатив: грант DELETE есть у любого authenticated, но политика
-- "superadmin can delete tool units" не пропускает строку - 0 строк, не
-- ошибка (USING отфильтровал, тот же принцип, что у tools).
select pg_temp.expect_affected(
  $$delete from public.tool_units where id = '00000000-0000-0000-0000-0000000008a1'$$, 0);

-- ---------------------------------------------------------------------
-- MANAGER
-- ---------------------------------------------------------------------
select pg_temp.act_as('manager@example.com');

-- негатив: менеджер тоже 0 строк - удаление единицы за SUPERADMIN.
select pg_temp.expect_affected(
  $$delete from public.tool_units where id = '00000000-0000-0000-0000-0000000008a1'$$, 0);

-- ---------------------------------------------------------------------
-- SUPERADMIN
-- ---------------------------------------------------------------------
select pg_temp.act_as('admin@example.com');

-- позитив: ни разу не выданная единица удаляется. До миграции этапа 8
-- здесь был бы 42501 (нет гранта).
select pg_temp.expect_affected(
  $$delete from public.tool_units where id = '00000000-0000-0000-0000-0000000008a1'$$, 1);

-- негатив: единица с историей аренд не удаляется никем - внешний ключ
-- rental_items.tool_unit_id (on delete restrict) даёт 23503. Политика
-- пропустила строку, остановило ограничение: история выдач защищена
-- независимо от роли.
select pg_temp.expect_error(
  $$delete from public.tool_units where id = '00000000-0000-0000-0000-0000000008a3'$$, '23503');

-- ---------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------
select pg_temp.act_as_anon();

-- негатив: у anon гранта нет вообще (revoke all этапа 4) - 42501 до RLS.
select pg_temp.expect_error(
  $$delete from public.tool_units where id = '00000000-0000-0000-0000-0000000008a2'$$);

rollback;
