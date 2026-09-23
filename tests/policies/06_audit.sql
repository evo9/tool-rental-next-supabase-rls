-- =====================================================================
-- Проверка политик и триггеров этапа 6: public.audit_log,
-- audit_log_row() на staff/tools/tool_units/customers/rentals/
-- rental_items/category_grace_periods.
--
-- Предусловия: миграции этапов 1-6 применены, npm run seed:staff
--   выполнен (нужны operator@example.com, manager@example.com,
--   admin@example.com).
-- Запуск:
--   SQL Editor: вставить целиком, Run. Дошёл до конца = всё прошло,
--     провал останавливает скрипт с текстом FAIL.
--   psql "$DB_URL" -f tests/policies/06_audit.sql - видны NOTICE по
--     каждой проверке.
-- В базе ничего не остаётся: всё внутри транзакции с ROLLBACK.
--
-- Порядок в этом файле важен иначе, чем в предыдущих: содержимое
-- audit_log можно проверить только под SUPERADMIN (политика "superadmin
-- reads audit log") - действия совершает OPERATOR, а читает лог после
-- этого ADMIN, а не тот же OPERATOR, который их совершил.
-- =====================================================================
begin;

-- --- вспомогательные функции (тот же формат, что в 05_pricing.sql) ----

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

-- service_role: скрипты с secret key (npm run seed:staff). Без "sub" в
-- claims - это не пользователь, а система, auth.uid() внутри вернёт NULL.
create function pg_temp.act_as_service() returns void
    language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
end $$;

create function pg_temp.expect_count(p_query text, p_expected bigint) returns void
    language plpgsql as $$
declare v bigint;
begin
  execute format('select count(*) from (%s) q', p_query) into v;
  if v <> p_expected then
    raise exception 'FAIL: ожидалось % строк, получено %: %', p_expected, v, p_query;
  end if;
  raise notice 'ok [% строк] %', v, p_query;
end $$;

-- Ожидает ошибку с кодом p_code. Ошибка с другим кодом - тоже FAIL.
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

-- --- вспомогательная таблица этого файла: захват результата issue_rental
-- (тот же приём, что в 04_rentals.sql и 05_pricing.sql) -----------------

create table pg_temp.rental_audit (rental_id uuid, rental_item_id uuid, tool_unit_id uuid);
grant select, insert on pg_temp.rental_audit to authenticated;

-- auth.users не читается ролью authenticated (Supabase не выдаёт на неё
-- грант API-ролям) - id тестовых сотрудников снимаем один раз, пока
-- действуем от имени postgres, и дальше сверяемся с этой копией, а не
-- с самой auth.users, под какой бы ролью ни шла проверка.
create table pg_temp.staff_uid (email text primary key, uid uuid not null);
grant select on pg_temp.staff_uid to authenticated;
insert into pg_temp.staff_uid (email, uid)
select email, id from auth.users
where email in ('operator@example.com', 'manager@example.com', 'admin@example.com');

-- --- фикстуры (postgres, мимо RLS; auth.uid() здесь NULL - claims ещё
-- не выставлены, тот же "системный" случай, что у service_role) -------

insert into public.tools (id, name, daily_rate, deposit_value) values
  ('00000000-0000-0000-0000-0000000006f0', '__Тест Аудит', 100, 1000);

insert into public.tool_units (id, tool_id, inventory_number, status) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000006f0', '__INV-D1', 'AVAILABLE');

insert into public.customers (id, full_name, phone, category) values
  ('00000000-0000-0000-0000-0000000006c1', 'Тест Клиент Аудит', '+380000000611', 'SILVER');

-- Проверка фикстуры делается ещё от имени postgres (до первого act_as) -
-- владелец таблицы обходит RLS, поэтому эта единственная проверка
-- содержимого audit_log в файле не под ролью SUPERADMIN, а "мимо" ролей
-- вообще, как и сама фикстура. Демонстрация пункта задания "действие без
-- пользователя: auth.uid() = null".
select pg_temp.expect_count(
  $$select 1 from public.audit_log
    where table_name = 'customers' and row_pk = '00000000-0000-0000-0000-0000000006c1'
      and op = 'INSERT' and actor_id is null and actor_role is null$$,
  1);

-- ---------------------------------------------------------------------
-- OPERATOR: действия, за которыми будем следить в логе
-- ---------------------------------------------------------------------
select pg_temp.act_as('operator@example.com');

-- выдача аренды - три записи в трёх таблицах на одно действие
-- пользователя, включая изменение статуса единицы чужим триггером.
insert into pg_temp.rental_audit (rental_id, rental_item_id, tool_unit_id)
select rental_id, rental_item_id, tool_unit_id from public.issue_rental(
  '00000000-0000-0000-0000-0000000006c1',
  now() + interval '3 days',
  array['00000000-0000-0000-0000-0000000006a1']::uuid[]
);

-- правка клиента - только одна колонка меняется.
update public.customers set full_name = '__Тест Клиент Аудит (правка)'
where id = '00000000-0000-0000-0000-0000000006c1';

-- негатив: сам оператор не может прочитать то, что только что записал -
-- политика "superadmin reads audit log" не пропускает ни одной строки
-- никому, кроме SUPERADMIN, даже автору записи.
select pg_temp.expect_count($$select 1 from public.audit_log$$, 0);

-- негатив: оператор не пишет в audit_log вообще - гранта на insert нет
-- ни у кого из authenticated (revoke all в миграции), 42501 ещё до
-- всякой политики.
select pg_temp.expect_error(
  $$insert into public.audit_log (table_name, op, row_pk) values ('x', 'INSERT', '1')$$);

-- ---------------------------------------------------------------------
-- MANAGER: тоже не видит и не пишет
-- ---------------------------------------------------------------------
select pg_temp.act_as('manager@example.com');

select pg_temp.expect_count($$select 1 from public.audit_log$$, 0);
select pg_temp.expect_error(
  $$insert into public.audit_log (table_name, op, row_pk) values ('x', 'INSERT', '1')$$);

-- ---------------------------------------------------------------------
-- SUPERADMIN: видит записи, сделанные оператором, но тоже не пишет
-- ---------------------------------------------------------------------
select pg_temp.act_as('admin@example.com');

-- INSERT в rentals - записан на оператора напрямую (issue_rental -
-- security invoker, вставку делает сам оператор).
select pg_temp.expect_count(
  $$select 1 from public.audit_log al
    join pg_temp.rental_audit ra on ra.rental_id::text = al.row_pk
    join pg_temp.staff_uid su on su.email = 'operator@example.com'
    where al.table_name = 'rentals' and al.op = 'INSERT' and al.actor_id = su.uid$$,
  1);

-- INSERT в rental_items - та же позиция, тот же оператор.
select pg_temp.expect_count(
  $$select 1 from public.audit_log al
    join pg_temp.rental_audit ra on ra.rental_item_id::text = al.row_pk
    join pg_temp.staff_uid su on su.email = 'operator@example.com'
    where al.table_name = 'rental_items' and al.op = 'INSERT' and al.actor_id = su.uid$$,
  1);

-- UPDATE tool_units.status в RENTED сделал не оператор напрямую (у него
-- нет гранта на эту колонку), а security definer триггер
-- rental_items_sync_unit этапа 4. auth.uid() внутри него по-прежнему
-- возвращает оператора - это и есть демонстрация задания: identity
-- (auth.uid(), из GUC сессии) не совпадает с исполняющей ролью
-- (эффективные права владельца функции).
select pg_temp.expect_count(
  $$select 1 from public.audit_log al
    join pg_temp.rental_audit ra on ra.tool_unit_id::text = al.row_pk
    join pg_temp.staff_uid su on su.email = 'operator@example.com'
    where al.table_name = 'tool_units' and al.op = 'UPDATE'
      and al.changed_fields = array['status'] and al.actor_id = su.uid$$,
  1);

-- UPDATE клиента - changed_fields содержит только реально изменённую
-- колонку (full_name), не весь набор колонок таблицы.
select pg_temp.expect_count(
  $$select 1 from public.audit_log
    where table_name = 'customers' and row_pk = '00000000-0000-0000-0000-0000000006c1'
      and op = 'UPDATE' and changed_fields = array['full_name']$$,
  1);

-- негатив: SUPERADMIN тоже не грантован ни на insert, ни на update, ни
-- на delete - у audit_log эти гранты не выданы вообще никому, роль
-- здесь ни при чём (в отличие от, например, tools, где SUPERADMIN может
-- то, что не может OPERATOR).
select pg_temp.expect_error(
  $$insert into public.audit_log (table_name, op, row_pk) values ('x', 'INSERT', '1')$$);
select pg_temp.expect_error(
  $$update public.audit_log set op = 'UPDATE' where table_name = 'customers'
    and row_pk = '00000000-0000-0000-0000-0000000006c1'$$);
select pg_temp.expect_error(
  $$delete from public.audit_log where table_name = 'customers'
    and row_pk = '00000000-0000-0000-0000-0000000006c1'$$);

-- ---------------------------------------------------------------------
-- service_role: BYPASSRLS не помогает без гранта
-- ---------------------------------------------------------------------
select pg_temp.act_as_service();

-- негатив: тот же 42501, что и у обычных ролей - BYPASSRLS обходит
-- только политики (второй слой), а не отсутствие гранта (первый слой),
-- до которого дело даже не доходит.
select pg_temp.expect_error(
  $$insert into public.audit_log (table_name, op, row_pk) values ('x', 'INSERT', '1')$$);

-- ---------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------
select pg_temp.act_as_anon();

-- негатив: anon получает 42501 на SELECT, а не пустой результат, как
-- OPERATOR/MANAGER выше. Разница - в том, на каком слое отказ: у
-- OPERATOR/MANAGER грант select есть (только политика не пропускает
-- строк), у anon гранта на audit_log нет вообще (revoke all from anon
-- в миграции) - отказ ещё до RLS, тот же принцип, что и у остальных
-- таблиц проекта (customers, rentals, ...).
select pg_temp.expect_error($$select 1 from public.audit_log$$);

rollback;
