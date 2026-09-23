-- =====================================================================
-- Проверка этапа 7: view public.dashboard_counts (security_invoker),
-- ловушка view без security_invoker, RPC public.import_tool_units(),
-- политика INSERT на tool_units, уникальный индекс на имя модели.
--
-- Предусловия: миграции этапов 1-7 применены, npm run seed:staff
--   выполнен (нужны operator@example.com и manager@example.com).
-- Запуск:
--   SQL Editor: вставить целиком, Run. Дошёл до конца = всё прошло,
--     провал останавливает скрипт с текстом FAIL.
--   psql "$DB_URL" -f tests/policies/07_dashboard_import.sql - видны
--     NOTICE по каждой проверке.
-- В базе ничего не остаётся: всё внутри транзакции с ROLLBACK.
--
-- Тест не рассчитывает на конкретные числа в базе (там могут лежать
-- данные сида): счётчики сверяются либо со снимком до фикстур плюс
-- известная добавка, либо с прямым подсчётом строк под той же ролью.
--
-- Порядок блоков важен: менеджер добавляет единицы, которые меняют
-- счётчики, поэтому все проверки счётчиков идут раньше его блока.
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

-- Залогиненный пользователь без строки в staff.
create function pg_temp.act_as_uid(p_uid uuid) returns void
    language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function pg_temp.act_as_anon() returns void
    language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
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

-- --- временные таблицы этого файла ------------------------------------

-- Результаты вызовов import_tool_units: RPC возвращает один jsonb, его
-- удобно сохранить под меткой и проверять обычными запросами.
create table pg_temp.import_result (label text primary key, r jsonb not null);
grant select, insert on pg_temp.import_result to authenticated;

-- Снимок счётчиков до фикстур (postgres, мимо RLS): точка отсчёта, чтобы
-- не зависеть от данных сида.
create table pg_temp.counts_before as
  select * from public.dashboard_counts;
grant select on pg_temp.counts_before to authenticated;

-- Что увидел активный сотрудник через view. Пустая копия структуры,
-- заполняется ниже под ролью сотрудника.
create table pg_temp.staff_seen as
  select * from public.dashboard_counts with no data;
grant select, insert on pg_temp.staff_seen to authenticated;

-- --- ловушка: два view с одним запросом, различие только в опции -------
-- Урезанная копия dashboard_counts (три колонки хватает для показа).
-- Временные view создаёт postgres, он и будет их владельцем - именно
-- владелец не подчиняется RLS базовых таблиц.
-- counts_definer - view по умолчанию (права владельца).
-- counts_invoker - тот же запрос с security_invoker = true.
create temp view counts_definer as
select
  (select count(*) from public.tool_units where status = 'AVAILABLE') as available,
  (select count(*) from public.tool_units where status = 'RENTED') as rented,
  (select count(*) from public.rentals where status = 'ACTIVE') as active_rentals;

create temp view counts_invoker
with (security_invoker = true)
as
select
  (select count(*) from public.tool_units where status = 'AVAILABLE') as available,
  (select count(*) from public.tool_units where status = 'RENTED') as rented,
  (select count(*) from public.rentals where status = 'ACTIVE') as active_rentals;

grant select on pg_temp.counts_definer to authenticated;
grant select on pg_temp.counts_invoker to authenticated;

-- --- фикстуры (postgres, мимо RLS) ------------------------------------
-- Набор подобран так, чтобы каждая колонка dashboard_counts получила
-- известную добавку:
--   A  - выдана, аренда просрочена       -> rented +1, overdue +1
--   B  - выдана, аренда не просрочена    -> rented +1
--   C  - свободна                        -> available +1
--   D  - UNAVAILABLE                     -> unavailable +1
--   E  - WRITTEN_OFF                     -> written_off +1
--   F  - выдана и возвращена (аренда CLOSED) -> available +1, аренда не
--        считается активной
--   G  - свободна, номер для проверки дубликата импорта -> available +1
-- Итого: available +3, rented +2, unavailable +1, written_off +1,
--   active_rentals +2 (аренды A и B), overdue_rentals +1.

insert into public.tools (id, name, daily_rate, deposit_value) values
  ('00000000-0000-0000-0000-0000000007f0', '__Test Import Existing', 100, 1000);

insert into public.tool_units (id, tool_id, inventory_number, status) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007f0', '__DASH-A', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-0000000007f0', '__DASH-B', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-0000000007f0', '__DASH-C', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000007a4', '00000000-0000-0000-0000-0000000007f0', '__DASH-D', 'UNAVAILABLE'),
  ('00000000-0000-0000-0000-0000000007a5', '00000000-0000-0000-0000-0000000007f0', '__DASH-E', 'WRITTEN_OFF'),
  ('00000000-0000-0000-0000-0000000007a6', '00000000-0000-0000-0000-0000000007f0', '__DASH-F', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000007a7', '00000000-0000-0000-0000-0000000007f0', '__IMPN-DB', 'AVAILABLE');

insert into public.customers (id, full_name, phone, category) values
  ('00000000-0000-0000-0000-0000000007c1', 'Тест Клиент Дашборд', '+380000000711', 'SILVER');

-- Аренды вставлены напрямую (postgres): управляемые issued_at и
-- planned_return_at дают детерминированную просрочку без pg_sleep (тот
-- же приём, что в 05_pricing.sql). created_by указан явно: как postgres,
-- default auth.uid() дал бы NULL, а колонка not null.
insert into public.rentals (id, customer_id, created_by, issued_at, planned_return_at) values
  ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007c1',
   (select id from auth.users where email = 'operator@example.com'),
   now() - interval '3 days', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000007b2', '00000000-0000-0000-0000-0000000007c1',
   (select id from auth.users where email = 'operator@example.com'),
   now(), now() + interval '2 days'),
  ('00000000-0000-0000-0000-0000000007b3', '00000000-0000-0000-0000-0000000007c1',
   (select id from auth.users where email = 'operator@example.com'),
   now() - interval '2 days', now() + interval '1 day');

-- Позиции: триггер rental_items_sync_unit переводит A, B, F в RENTED.
insert into public.rental_items (id, rental_id, tool_unit_id) values
  ('00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007a1'),
  ('00000000-0000-0000-0000-0000000007d2', '00000000-0000-0000-0000-0000000007b2', '00000000-0000-0000-0000-0000000007a2'),
  ('00000000-0000-0000-0000-0000000007d3', '00000000-0000-0000-0000-0000000007b3', '00000000-0000-0000-0000-0000000007a6');

-- Возврат позиции F: единица снова AVAILABLE, аренда b3 - CLOSED (оба
-- изменения делает rental_items_sync_unit). Путь к фото - в папке своей
-- аренды/позиции, иначе не пройдёт check rental_items_return_photo_own_folder.
update public.rental_items
set return_photo_path = '00000000-0000-0000-0000-0000000007b3/00000000-0000-0000-0000-0000000007d3/return-test.jpg',
    returned_at = now()
where id = '00000000-0000-0000-0000-0000000007d3';

-- ---------------------------------------------------------------------
-- OPERATOR (активный сотрудник): счётчики
-- ---------------------------------------------------------------------
select pg_temp.act_as('operator@example.com');

-- позитив: view под сотрудником даёт снимок до фикстур плюс известная
-- добавка. Числа не совпали бы, если бы политики базовых таблиц
-- отфильтровали строки (это то, что увидит не-сотрудник ниже).
select pg_temp.expect_count(
  $$select 1 from public.dashboard_counts d, pg_temp.counts_before b
    where d.available = b.available + 3
      and d.rented = b.rented + 2
      and d.unavailable = b.unavailable + 1
      and d.written_off = b.written_off + 1
      and d.active_rentals = b.active_rentals + 2
      and d.overdue_rentals = b.overdue_rentals + 1$$,
  1);

-- позитив: те же числа считаются прямыми запросами под той же ролью.
-- Расхождение означало бы, что view считает не то, что видит сотрудник.
select pg_temp.expect_count(
  $$select 1 from public.dashboard_counts d
    where d.available = (select count(*) from public.tool_units where status = 'AVAILABLE')
      and d.rented = (select count(*) from public.tool_units where status = 'RENTED')
      and d.unavailable = (select count(*) from public.tool_units where status = 'UNAVAILABLE')
      and d.written_off = (select count(*) from public.tool_units where status = 'WRITTEN_OFF')
      and d.active_rentals = (select count(*) from public.rentals where status = 'ACTIVE')
      and d.overdue_rentals = (select count(*) from public.rentals
        where status = 'ACTIVE' and planned_return_at < now())$$,
  1);

-- Запоминаем, что видит сотрудник, для сравнения с ловушкой ниже.
insert into pg_temp.staff_seen select * from public.dashboard_counts;

-- негатив: во view не пишет никто - у authenticated и anon только select.
-- Проверяется по грантам, а не попыткой insert: view из агрегатов не
-- обновляемый, и Postgres отказал бы ещё на разборе запроса кодом 0A000,
-- не дойдя до проверки прав, - это не то, что мы хотим зафиксировать.
select pg_temp.expect_count(
  $$select 1 where
      has_table_privilege('authenticated', 'public.dashboard_counts', 'SELECT')
      and not has_table_privilege('authenticated', 'public.dashboard_counts', 'INSERT')
      and not has_table_privilege('authenticated', 'public.dashboard_counts', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.dashboard_counts', 'DELETE')
      and not has_table_privilege('anon', 'public.dashboard_counts', 'SELECT')$$,
  1);

-- негатив: оператор не заводит единицы. Грант insert на tool_units есть
-- у любого authenticated, но WITH CHECK политики требует MANAGER+ (тот же
-- отказ, что был до этапа 7): для INSERT провал политики - всегда ошибка
-- 42501, а не 0 строк.
select pg_temp.expect_error(
  $$insert into public.tool_units (tool_id, inventory_number)
    values ('00000000-0000-0000-0000-0000000007f0', '__OP-NEW')$$);

-- ---------------------------------------------------------------------
-- OPERATOR: импорт
-- ---------------------------------------------------------------------

-- Оператор вызывает import_tool_units. Функция security invoker, поэтому
-- права вставки решают политики "tools: manager+ inserts" и
-- "manager+ can insert tool units". Три строки - три места отказа:
--   строка 2 - существующая модель, новая единица: 42501 на tool_units;
--   строка 3 - новая модель: 42501 уже на вставке в tools;
--   строка 4 - то же без status: тот же отказ.
-- Функция при этом не падает: ошибка каждой строки попадает в отчёт.
insert into pg_temp.import_result
select 'operator', public.import_tool_units($j$[
  {"line": 2, "tool_name": "__Test Import Existing", "daily_rate": 100,
   "deposit": 1000, "inventory_number": "__IMPO-1", "status": "AVAILABLE"},
  {"line": 3, "tool_name": "__Test Import Op New", "daily_rate": 10,
   "deposit": 20, "inventory_number": "__IMPO-2", "status": "AVAILABLE"},
  {"line": 4, "tool_name": "__Test Import Op New", "daily_rate": 10,
   "deposit": 20, "inventory_number": "__IMPO-3"}
]$j$::jsonb);

-- позитив по смыслу отчёта: ничего не вставлено, все три строки в
-- ошибках, и у каждой код 42501 (отказ политики, а не что-то иное).
select pg_temp.expect_count(
  $$select 1 from pg_temp.import_result
    where label = 'operator'
      and (r ->> 'inserted')::int = 0
      and jsonb_array_length(r -> 'errors') = 3
      and not exists (
        select 1 from jsonb_array_elements(r -> 'errors') e
        where e ->> 'code' <> '42501'
      )$$,
  1);

-- негатив: в базе действительно ничего не появилось (ни единицы, ни
-- модель). Сам отчёт мог бы соврать, таблицы - нет.
select pg_temp.expect_count(
  $$select 1 from public.tool_units where starts_with(inventory_number, '__IMPO-')$$, 0);
select pg_temp.expect_count(
  $$select 1 from public.tools where name = '__Test Import Op New'$$, 0);

-- ---------------------------------------------------------------------
-- Залогинен, но нет строки в staff: нули и ловушка view
-- ---------------------------------------------------------------------
select pg_temp.act_as_uid(gen_random_uuid());

-- Прямой запрос: RLS не пропускает ни одной строки.
select pg_temp.expect_count($$select 1 from public.tool_units$$, 0);
select pg_temp.expect_count($$select 1 from public.rentals$$, 0);

-- негатив: dashboard_counts (security_invoker) не-сотруднику отдаёт ОДНУ
-- строку из нулей, а не пустой результат и не 42501. Грант select на view
-- у authenticated есть, значит первый слой пройден; внутри запрос идёт
-- с правами вызывающего, политики базовых таблиц отсекают все строки, а
-- count(*) по нулю строк возвращает 0 (агрегат без group by всегда даёт
-- ровно одну строку). Цифры точки проката такой пользователь не видит.
select pg_temp.expect_count(
  $$select 1 from public.dashboard_counts
    where available = 0 and rented = 0 and unavailable = 0
      and written_off = 0 and active_rentals = 0 and overdue_rentals = 0$$,
  1);

-- та же защита у урезанной копии с security_invoker = true: нули.
select pg_temp.expect_count(
  $$select 1 from pg_temp.counts_invoker
    where available = 0 and rented = 0 and active_rentals = 0$$,
  1);

-- ЛОВУШКА: тот же запрос без security_invoker. View выполняется с правами
-- владельца (postgres), а владелец таблиц не подчиняется RLS. Не-сотрудник,
-- которому прямой запрос выше дал 0 строк, через этот view получает
-- настоящие числа - те же, что видел активный сотрудник. Права на базовые
-- таблицы при этом проверяются у владельца view, не у вызывающего.
select pg_temp.expect_count(
  $$select 1 from pg_temp.counts_definer d
    join pg_temp.staff_seen s
      on d.available = s.available
     and d.rented = s.rented
     and d.active_rentals = s.active_rentals
    where d.rented >= 2 and d.available >= 3$$,
  1);

-- Не-сотрудник вызывает импорт: политики отсекают его на первой же
-- вставке (модель не видна и не создаётся) - строка в отчёте с 42501.
insert into pg_temp.import_result
select 'nonstaff', public.import_tool_units($j$[
  {"line": 2, "tool_name": "__Test Import Ghost", "daily_rate": 1,
   "deposit": 1, "inventory_number": "__IMPG-1"}
]$j$::jsonb);

select pg_temp.expect_count(
  $$select 1 from pg_temp.import_result
    where label = 'nonstaff'
      and (r ->> 'inserted')::int = 0
      and r -> 'errors' -> 0 ->> 'code' = '42501'$$,
  1);

-- ---------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------
select pg_temp.act_as_anon();

-- негатив: у anon нет гранта select на view - 42501 на первом слое, до
-- RLS. Не нули, как у залогиненного без staff: разница в том, на каком
-- слое отказ.
select pg_temp.expect_error($$select 1 from public.dashboard_counts$$);

-- негатив: execute на import_tool_units отозван у public и anon - отказ
-- на самом вызове, а не отчёт с ошибками в каждой строке.
select pg_temp.expect_error(
  $$select public.import_tool_units('[]'::jsonb)$$);

-- ---------------------------------------------------------------------
-- MANAGER: единицы и импорт
-- ---------------------------------------------------------------------
select pg_temp.act_as('manager@example.com');

-- позитив: view видит любая роль сотрудника, не только оператор.
select pg_temp.expect_count(
  $$select 1 from public.dashboard_counts d
    where d.available = (select count(*) from public.tool_units where status = 'AVAILABLE')
      and d.active_rentals = (select count(*) from public.rentals where status = 'ACTIVE')$$,
  1);

-- Политика INSERT на tool_units: стартовые статусы.
-- позитив: AVAILABLE (по умолчанию) и UNAVAILABLE.
select pg_temp.expect_affected(
  $$insert into public.tool_units (tool_id, inventory_number)
    values ('00000000-0000-0000-0000-0000000007f0', '__MGR-1')$$, 1);
select pg_temp.expect_affected(
  $$insert into public.tool_units (tool_id, inventory_number, status)
    values ('00000000-0000-0000-0000-0000000007f0', '__MGR-2', 'UNAVAILABLE')$$, 1);

-- негатив: RENTED и WRITTEN_OFF при создании - 42501 (WITH CHECK). Без
-- этой проверки единица RENTED без аренды обошла бы триггер
-- tool_units_guard_status, который срабатывает только на UPDATE.
select pg_temp.expect_error(
  $$insert into public.tool_units (tool_id, inventory_number, status)
    values ('00000000-0000-0000-0000-0000000007f0', '__MGR-3', 'RENTED')$$);
select pg_temp.expect_error(
  $$insert into public.tool_units (tool_id, inventory_number, status)
    values ('00000000-0000-0000-0000-0000000007f0', '__MGR-4', 'WRITTEN_OFF')$$);

-- Уникальный индекс tools_name_normalized_key: то же имя в другом
-- регистре и с пробелами - 23505.
select pg_temp.expect_error(
  $$insert into public.tools (name, daily_rate, deposit_value)
    values ('  __TEST import EXISTING ', 1, 1)$$,
  '23505');

-- Импорт менеджером: девять строк, три вставятся, шесть уйдут в отчёт.
--   2: существующая модель, записанная с лишними пробелами и в другом
--      регистре, - находится через lower(btrim(name)), дубль модели не
--      создаётся; тариф из файла (999) для существующей модели игнорируется
--   3: новая модель, статус UNAVAILABLE - создаётся вместе с единицей
--   4: тот же инвентарный номер, что в строке 2 - 23505 (дубль внутри
--      файла: первая строка уже вставлена)
--   5: та же новая модель в другом регистре - находится, дубля нет
--   6: инвентарный номер, который уже есть в базе (фикстура G) - 23505
--   7: status RENTED - P0001 (явная проверка функции)
--   8: новая модель, daily_rate не число - 22P02 (обычно ловит zod ещё до
--      базы, здесь проверяем, что функция не падает целиком; для уже
--      существующей модели тариф из файла не читается вообще, поэтому
--      модель нужна новая)
--   9: новая модель с отрицательным тарифом - 23514 (check tools): строка
--      падает на самой модели, до вставки единицы
--  10: новая модель с корректным тарифом, но номер единицы уже занят
--      (фикстура G) - 23505. Модель эта строка успела создать, а единица
--      упала: подтранзакция откатывает и модель, сирота не остаётся
insert into pg_temp.import_result
select 'manager', public.import_tool_units($j$[
  {"line": 2, "tool_name": "  __TEST import EXISTING  ", "daily_rate": 999,
   "deposit": 999, "inventory_number": "__IMPN-1"},
  {"line": 3, "tool_name": "__Test Import New", "daily_rate": 55.5,
   "deposit": 500, "inventory_number": "__IMPN-2", "status": "UNAVAILABLE"},
  {"line": 4, "tool_name": "__Test Import Existing", "daily_rate": 100,
   "deposit": 1000, "inventory_number": "__IMPN-1"},
  {"line": 5, "tool_name": "__TEST IMPORT NEW", "daily_rate": 55.5,
   "deposit": 500, "inventory_number": "__IMPN-3", "status": ""},
  {"line": 6, "tool_name": "__Test Import Existing", "daily_rate": 100,
   "deposit": 1000, "inventory_number": "__IMPN-DB"},
  {"line": 7, "tool_name": "__Test Import Existing", "daily_rate": 100,
   "deposit": 1000, "inventory_number": "__IMPN-4", "status": "RENTED"},
  {"line": 8, "tool_name": "__Test Import Bad", "daily_rate": "abc",
   "deposit": 500, "inventory_number": "__IMPN-5"},
  {"line": 9, "tool_name": "__Test Import Neg", "daily_rate": -5,
   "deposit": 10, "inventory_number": "__IMPN-6"},
  {"line": 10, "tool_name": "__Test Import Orphan", "daily_rate": 30,
   "deposit": 60, "inventory_number": "__IMPN-DB"}
]$j$::jsonb);

-- позитив: вставлено три строки, остальные в отчёте с нужными номерами
-- строк и SQLSTATE. Сравнение одним jsonb: порядок и коды - ровно те,
-- что описаны выше.
select pg_temp.expect_count(
  $$select 1 from pg_temp.import_result
    where label = 'manager'
      and (r ->> 'inserted')::int = 3
      and (
        select jsonb_agg(
                 jsonb_build_array((e ->> 'line')::int, e ->> 'code')
                 order by (e ->> 'line')::int)
        from jsonb_array_elements(r -> 'errors') e
      ) = '[[4,"23505"],[6,"23505"],[7,"P0001"],[8,"22P02"],[9,"23514"],[10,"23505"]]'::jsonb$$,
  1);

-- Проверка состояния базы, а не только отчёта.
-- строка 2: единица привязана к существующей модели, дубля модели нет,
-- тариф модели не изменён файлом (100, не 999).
select pg_temp.expect_count(
  $$select 1 from public.tool_units u
    join public.tools t on t.id = u.tool_id
    where u.inventory_number = '__IMPN-1'
      and t.id = '00000000-0000-0000-0000-0000000007f0'
      and t.daily_rate = 100
      and u.status = 'AVAILABLE'$$,
  1);
select pg_temp.expect_count(
  $$select 1 from public.tools where lower(btrim(name)) = '__test import existing'$$, 1);

-- строки 3 и 5: одна новая модель с тарифом из файла, две её единицы -
-- вторая строка нашла модель, созданную первой (нормализация имени).
select pg_temp.expect_count(
  $$select 1 from public.tools where lower(btrim(name)) = '__test import new'$$, 1);
select pg_temp.expect_count(
  $$select 1 from public.tools t
    join public.tool_units u2 on u2.tool_id = t.id and u2.inventory_number = '__IMPN-2'
    join public.tool_units u3 on u3.tool_id = t.id and u3.inventory_number = '__IMPN-3'
    where t.daily_rate = 55.50 and t.deposit_value = 500
      and u2.status = 'UNAVAILABLE' and u3.status = 'AVAILABLE'$$,
  1);

-- строки 7-9: единиц с этими номерами нет.
select pg_temp.expect_count(
  $$select 1 from public.tool_units
    where inventory_number in ('__IMPN-4', '__IMPN-5', '__IMPN-6')$$,
  0);

-- строки 8 и 9 упали на самой вставке модели - модели не появилось.
select pg_temp.expect_count(
  $$select 1 from public.tools
    where name in ('__Test Import Neg', '__Test Import Bad')$$, 0);

-- ПОДТРАНЗАКЦИЯ: строка 10 успела вставить модель '__Test Import Orphan',
-- потом единица упала на дубле номера. Без savepoint модель осталась бы
-- в базе без единицы; блок begin ... exception откатил её вместе со
-- строкой. Вставка модели и единицы в одной строке - единое целое.
select pg_temp.expect_count(
  $$select 1 from public.tools where name = '__Test Import Orphan'$$, 0);

-- Повторный импорт валидных строк того же файла (2, 3, 5): всё уже есть,
-- каждая строка - дубликат, в базе ничего нового.
insert into pg_temp.import_result
select 'manager-repeat', public.import_tool_units($j$[
  {"line": 2, "tool_name": "  __TEST import EXISTING  ", "daily_rate": 999,
   "deposit": 999, "inventory_number": "__IMPN-1"},
  {"line": 3, "tool_name": "__Test Import New", "daily_rate": 55.5,
   "deposit": 500, "inventory_number": "__IMPN-2", "status": "UNAVAILABLE"},
  {"line": 5, "tool_name": "__TEST IMPORT NEW", "daily_rate": 55.5,
   "deposit": 500, "inventory_number": "__IMPN-3", "status": ""}
]$j$::jsonb);

select pg_temp.expect_count(
  $$select 1 from pg_temp.import_result
    where label = 'manager-repeat'
      and (r ->> 'inserted')::int = 0
      and jsonb_array_length(r -> 'errors') = 3
      and not exists (
        select 1 from jsonb_array_elements(r -> 'errors') e
        where e ->> 'code' <> '23505'
      )$$,
  1);
select pg_temp.expect_count(
  $$select 1 from public.tools where lower(btrim(name)) = '__test import new'$$, 1);

-- Граничные вызовы. Пустой массив - не ошибка, просто ноль строк.
insert into pg_temp.import_result
select 'manager-empty', public.import_tool_units('[]'::jsonb);
select pg_temp.expect_count(
  $$select 1 from pg_temp.import_result
    where label = 'manager-empty'
      and (r ->> 'inserted')::int = 0
      and jsonb_array_length(r -> 'errors') = 0$$,
  1);

-- негатив: не массив - это ошибка вызова, а не строки, и она бросается
-- наружу (P0001), а не прячется в отчёт.
select pg_temp.expect_error(
  $$select public.import_tool_units('{"a": 1}'::jsonb)$$, 'P0001');

rollback;
