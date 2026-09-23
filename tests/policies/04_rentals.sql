-- =====================================================================
-- Проверка политик и триггеров этапа 4: public.tool_units,
-- public.rentals, public.rental_items, RPC issue_rental/return_rental_items,
-- бакет rental-photos.
--
-- Предусловия: миграции этапа 4 применены, npm run seed:staff выполнен
--   (нужны operator@example.com, manager@example.com, admin@example.com).
-- Запуск:
--   SQL Editor: вставить целиком, Run. Дошёл до конца = всё прошло,
--     провал останавливает скрипт с текстом FAIL.
--   psql "$DB_URL" -f tests/policies/04_rentals.sql - видны NOTICE по
--     каждой проверке.
-- В базе ничего не остаётся: всё внутри транзакции с ROLLBACK,
-- вспомогательные функции и временные таблицы в pg_temp исчезают вместе
-- с ней.
-- =====================================================================
begin;

-- --- вспомогательные функции (тот же формат, что в 02_roles.sql и
-- 03_customers.sql) --------------------------------------------------

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

-- Ожидает ошибку с кодом p_code. Ошибка с другим кодом - тоже FAIL:
-- 23505 вместо 42501 значит, что до политики или триггера дело не дошло.
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

-- --- вспомогательные функции этого файла: захват результата issue_rental
-- и сборка путей/JSON для return_rental_items, чтобы сами проверки ниже
-- читались как обычные запросы, а не конкатенация строк -----------------

create table pg_temp.rental_main (rental_id uuid, rental_item_id uuid, tool_unit_id uuid);
create table pg_temp.rental_c (rental_id uuid, rental_item_id uuid, tool_unit_id uuid);
-- Таблицы созданы от текущей роли (postgres, до первого act_as), а
-- захват результата и последующие чтения идут уже под authenticated -
-- тот же самый урок про явные гранты, что и во всём остальном проекте,
-- просто здесь он про собственную инфраструктуру теста, а не про схему.
grant select, insert on pg_temp.rental_main, pg_temp.rental_c to authenticated;

-- p_table - имя временной таблицы обычным text, не regclass: приведение
-- regclass обратно к тексту не гарантирует схему pg_temp в результате,
-- а лишняя неоднозначность здесь ни к чему.
create function pg_temp.item_in(p_table text, p_unit uuid) returns uuid
    language plpgsql as $$
declare v uuid;
begin
  execute format('select rental_item_id from %s where tool_unit_id = $1', p_table)
    into v using p_unit;
  return v;
end $$;

create function pg_temp.rental_of(p_table text) returns uuid
    language plpgsql as $$
declare v uuid;
begin
  execute format('select rental_id from %s limit 1', p_table) into v;
  return v;
end $$;

create function pg_temp.photo_path(p_rental uuid, p_item uuid, p_kind text) returns text
    language sql as $$
  select p_rental::text || '/' || p_item::text || '/' || p_kind || '-test.jpg'
$$;

-- Готовая строка SQL для return_rental_items с одной позицией - сама
-- проверка ниже вызывает pg_temp.return_one(...), не собирает jsonb руками.
create function pg_temp.return_one(p_item uuid, p_photo_path text) returns text
    language sql as $$
  select format(
    $f$select public.return_rental_items(
       jsonb_build_array(jsonb_build_object('item_id', %L::uuid, 'photo_path', %L))
     )$f$,
    p_item, p_photo_path
  )
$$;

-- --- фикстуры (postgres, мимо RLS) ------------------------------------

insert into public.tools (id, name, daily_rate, deposit_value) values
  ('00000000-0000-0000-0000-0000000004f0', '__Тест Перфоратор', 100, 1000);

insert into public.tool_units (id, tool_id, inventory_number, status) values
  ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004f0', '__INV-A1', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000004a2', '00000000-0000-0000-0000-0000000004f0', '__INV-A2', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000004a3', '00000000-0000-0000-0000-0000000004f0', '__INV-A3', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000004a4', '00000000-0000-0000-0000-0000000004f0', '__INV-A4', 'UNAVAILABLE'),
  ('00000000-0000-0000-0000-0000000004a5', '00000000-0000-0000-0000-0000000004f0', '__INV-A5', 'WRITTEN_OFF'),
  ('00000000-0000-0000-0000-0000000004a6', '00000000-0000-0000-0000-0000000004f0', '__INV-A6', 'AVAILABLE');

insert into public.customers (id, full_name, phone) values
  ('00000000-0000-0000-0000-0000000004c1', 'Тест Клиент Аренда', '+380000000411');
insert into public.customers (id, full_name, phone, category) values
  ('00000000-0000-0000-0000-0000000004c2', 'Тест Нон Грата', '+380000000412', 'NON_GRATA');

-- ---------------------------------------------------------------------
-- OPERATOR
-- ---------------------------------------------------------------------
select pg_temp.act_as('operator@example.com');

-- позитив: issue_rental выдаёт две единицы одной транзакцией
insert into pg_temp.rental_main (rental_id, rental_item_id, tool_unit_id)
select rental_id, rental_item_id, tool_unit_id from public.issue_rental(
  '00000000-0000-0000-0000-0000000004c1',
  now() + interval '3 days',
  array['00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a2']::uuid[]
);
select pg_temp.expect_count($$select 1 from pg_temp.rental_main$$, 2);

-- обе единицы RENTED - rental_items_sync_unit сработал на обе вставки
select pg_temp.expect_count(
  $$select 1 from public.tool_units
    where id in ('00000000-0000-0000-0000-0000000004a1', '00000000-0000-0000-0000-0000000004a2')
      and status = 'RENTED'$$,
  2);

-- аренда ACTIVE
select pg_temp.expect_count(
  format($$select 1 from public.rentals where id = %L and status = 'ACTIVE'$$, pg_temp.rental_of('pg_temp.rental_main')),
  1);

-- единица __INV-A3 выдана отдельной арендой - пригодится ниже для
-- проверки повторной активной выдачи и возврата без фото
insert into pg_temp.rental_c (rental_id, rental_item_id, tool_unit_id)
select rental_id, rental_item_id, tool_unit_id from public.issue_rental(
  '00000000-0000-0000-0000-0000000004c1',
  now() + interval '3 days',
  array['00000000-0000-0000-0000-0000000004a3']::uuid[]
);
select pg_temp.expect_count($$select 1 from pg_temp.rental_c$$, 1);

-- негатив: возврат без фото - rental_items_return_requires_photo, 23514.
-- Прямой UPDATE, не RPC: returned_at есть в SET, триггер срабатывает,
-- return_photo_path остаётся null.
select pg_temp.expect_error(
  format($$update public.rental_items set returned_at = now() where id = %L$$, pg_temp.item_in('pg_temp.rental_c', '00000000-0000-0000-0000-0000000004a3')),
  '23514');

-- негатив: та же единица (__INV-A3, всё ещё активна) во второй аренде -
-- частичный уникальный индекс rental_items_active_unit, 23505.
select pg_temp.expect_error(
  format($$select public.issue_rental(%L, now() + interval '1 day', array[%L]::uuid[])$$,
    '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004a3'),
  '23505');

-- негатив: выдача единицы в статусе UNAVAILABLE - rental_items_sync_unit,
-- P0001. rentals без единой позиции не остаётся (см. следующую проверку).
select pg_temp.expect_error(
  format($$select public.issue_rental(%L, now() + interval '1 day', array[%L]::uuid[])$$,
    '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004a4'),
  'P0001');

-- негатив: выдача единицы WRITTEN_OFF - тот же путь, P0001.
select pg_temp.expect_error(
  format($$select public.issue_rental(%L, now() + interval '1 day', array[%L]::uuid[])$$,
    '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004a5'),
  'P0001');

-- негатив: клиент NON_GRATA - rentals_guard_customer, P0001. Единица
-- __INV-A6 (AVAILABLE) выбрана для этой проверки нарочно: должна остаться
-- нетронутой для проверки дубля ниже.
select pg_temp.expect_error(
  format($$select public.issue_rental(%L, now() + interval '1 day', array[%L]::uuid[])$$,
    '00000000-0000-0000-0000-0000000004c2', '00000000-0000-0000-0000-0000000004a6'),
  'P0001');

-- негатив: массив с дубликатом единицы - ошибка до первой вставки,
-- аренда не создаётся. Проверяем и код ошибки, и то, что число аренд
-- клиента не изменилось.
select pg_temp.expect_count(
  $$select 1 from public.rentals where customer_id = '00000000-0000-0000-0000-0000000004c1'$$,
  2);
select pg_temp.expect_error(
  format($$select public.issue_rental(%L, now() + interval '1 day', array[%L, %L]::uuid[])$$,
    '00000000-0000-0000-0000-0000000004c1',
    '00000000-0000-0000-0000-0000000004a6', '00000000-0000-0000-0000-0000000004a6'),
  'P0001');
select pg_temp.expect_count(
  $$select 1 from public.rentals where customer_id = '00000000-0000-0000-0000-0000000004c1'$$,
  2);
-- __INV-A6 не тронута ни одной из провалившихся попыток
select pg_temp.expect_count(
  $$select 1 from public.tool_units where id = '00000000-0000-0000-0000-0000000004a6' and status = 'AVAILABLE'$$,
  1);

-- позитив: частичный возврат __INV-A1 через RPC - единица AVAILABLE,
-- аренда остаётся ACTIVE, потому что __INV-A2 ещё не возвращена.
select pg_temp.expect_affected(
  pg_temp.return_one(
    pg_temp.item_in('pg_temp.rental_main', '00000000-0000-0000-0000-0000000004a1'),
    pg_temp.photo_path(pg_temp.rental_of('pg_temp.rental_main'),
      pg_temp.item_in('pg_temp.rental_main', '00000000-0000-0000-0000-0000000004a1'), 'return')
  ),
  1);
select pg_temp.expect_count(
  $$select 1 from public.tool_units where id = '00000000-0000-0000-0000-0000000004a1' and status = 'AVAILABLE'$$,
  1);
select pg_temp.expect_count(
  format($$select 1 from public.rentals where id = %L and status = 'ACTIVE'$$, pg_temp.rental_of('pg_temp.rental_main')),
  1);

-- позитив: возврат __INV-A2 напрямую UPDATE, без RPC - тот же результат,
-- что через return_rental_items: правила держат триггеры и ограничения,
-- а не сама функция. Заодно проверка "время ставит база": клиент шлёт
-- returned_at в 2000 году, база заменяет его на now().
select pg_temp.expect_affected(
  format(
    $$update public.rental_items
      set return_photo_path = %L, returned_at = '2000-01-01T00:00:00Z'::timestamptz
      where id = %L$$,
    pg_temp.photo_path(pg_temp.rental_of('pg_temp.rental_main'),
      pg_temp.item_in('pg_temp.rental_main', '00000000-0000-0000-0000-0000000004a2'), 'return'),
    pg_temp.item_in('pg_temp.rental_main', '00000000-0000-0000-0000-0000000004a2')
  ),
  1);
select pg_temp.expect_count(
  format($$select 1 from public.rental_items where id = %L and returned_at > now() - interval '1 minute'$$,
    pg_temp.item_in('pg_temp.rental_main', '00000000-0000-0000-0000-0000000004a2')),
  1);
select pg_temp.expect_count(
  $$select 1 from public.tool_units where id = '00000000-0000-0000-0000-0000000004a2' and status = 'AVAILABLE'$$,
  1);
-- обе позиции возвращены - rental_items_sync_unit закрыл аренду сам,
-- без отдельного запроса от приложения
select pg_temp.expect_count(
  format($$select 1 from public.rentals where id = %L and status = 'CLOSED' and closed_at is not null$$,
    pg_temp.rental_of('pg_temp.rental_main')),
  1);

-- негатив: returned_at обратно в null для уже возвращённой позиции -
-- rental_items_set_return, P0001 ("already recorded").
select pg_temp.expect_error(
  format($$update public.rental_items set returned_at = null where id = %L$$,
    pg_temp.item_in('pg_temp.rental_main', '00000000-0000-0000-0000-0000000004a2')),
  'P0001');

-- негатив: оператор меняет tool_units.status напрямую. Грант на эту
-- колонку у authenticated есть (иначе не дошли бы до политики), но
-- политика "manager+ can update tool units" требует роль MANAGER+ -
-- USING не пропускает строку, поэтому результат 0 затронутых строк,
-- а не ошибка (тот же механизм, что у staff в главе 02).
select pg_temp.expect_affected(
  $$update public.tool_units set status = 'AVAILABLE' where id = '00000000-0000-0000-0000-0000000004a4'$$,
  0);

-- негатив: оператор пишет created_by при создании аренды - нет гранта
-- на эту колонку, 42501 ещё до всякой политики. Значение не важно (годится
-- любой uuid): отказ срабатывает на самом упоминании колонки в INSERT,
-- до проверки её содержимого - настоящий user_id тут не нужен, а auth.users
-- в любом случае недоступна роли authenticated напрямую.
select pg_temp.expect_error(
  format($$insert into public.rentals (customer_id, planned_return_at, created_by)
    values (%L, now() + interval '1 day', gen_random_uuid())$$,
    '00000000-0000-0000-0000-0000000004c1'));

-- негатив: то же для issued_at.
select pg_temp.expect_error(
  format($$insert into public.rentals (customer_id, planned_return_at, issued_at)
    values (%L, now() + interval '1 day', now())$$,
    '00000000-0000-0000-0000-0000000004c1'));

-- негатив: DELETE rentals и rental_items - грант не выдан никому.
select pg_temp.expect_error(
  format($$delete from public.rentals where id = %L$$, pg_temp.rental_of('pg_temp.rental_main')));
select pg_temp.expect_error(
  format($$delete from public.rental_items where id = %L$$,
    pg_temp.item_in('pg_temp.rental_main', '00000000-0000-0000-0000-0000000004a1')));

-- негатив: загрузка в rental-photos по чужому пути.
-- Аренда существует, но позиция принадлежит другой аренде (rental_c) -
-- exists в политике не находит строку с обоими условиями сразу.
select pg_temp.expect_error(
  format($$insert into storage.objects (bucket_id, name) values ('rental-photos', %L)$$,
    pg_temp.rental_of('pg_temp.rental_main')::text || '/' ||
      pg_temp.item_in('pg_temp.rental_c', '00000000-0000-0000-0000-0000000004a3')::text || '/issue-test.jpg'));

-- негатив: загрузка в rental-photos с несуществующей арендой в пути.
select pg_temp.expect_error(
  format($$insert into storage.objects (bucket_id, name) values ('rental-photos', %L)$$,
    gen_random_uuid()::text || '/' || gen_random_uuid()::text || '/issue-test.jpg'));

-- позитив: загрузка в rental-photos по настоящему пути (позиция __INV-A3,
-- всё ещё активна и принадлежит своей же аренде rental_c).
select pg_temp.expect_affected(
  format($$insert into storage.objects (bucket_id, name) values ('rental-photos', %L)$$,
    pg_temp.rental_of('pg_temp.rental_c')::text || '/' ||
      pg_temp.item_in('pg_temp.rental_c', '00000000-0000-0000-0000-0000000004a3')::text || '/issue-test.jpg'),
  1);

-- ---------------------------------------------------------------------
-- MANAGER
-- ---------------------------------------------------------------------
select pg_temp.act_as('manager@example.com');

-- негатив: менеджер ставит RENTED руками единице __INV-A6 (AVAILABLE,
-- ни разу не выдавалась в этом сценарии) - у неё нет активной позиции
-- в rental_items, tool_units_guard_status отказывает, P0001.
select pg_temp.expect_error(
  $$update public.tool_units set status = 'RENTED' where id = '00000000-0000-0000-0000-0000000004a6'$$,
  'P0001');

-- негатив: менеджер выводит WRITTEN_OFF обратно в AVAILABLE -
-- tool_units_guard_status, терминальный статус, P0001.
select pg_temp.expect_error(
  $$update public.tool_units set status = 'AVAILABLE' where id = '00000000-0000-0000-0000-0000000004a5'$$,
  'P0001');

-- негатив: DELETE недоступен и менеджеру.
select pg_temp.expect_error(
  format($$delete from public.rental_items where id = %L$$,
    pg_temp.item_in('pg_temp.rental_c', '00000000-0000-0000-0000-0000000004a3')));

-- ---------------------------------------------------------------------
-- SUPERADMIN
-- ---------------------------------------------------------------------
select pg_temp.act_as('admin@example.com');

-- негатив: DELETE недоступен и суперадмину - в отличие от staff (глава
-- 02) и tool_units выше, у rentals/rental_items это правило без
-- исключений: история выдачи не удаляется никем.
select pg_temp.expect_error(
  format($$delete from public.rentals where id = %L$$, pg_temp.rental_of('pg_temp.rental_c')));

-- ---------------------------------------------------------------------
-- Залогинен, но нет строки в staff
-- ---------------------------------------------------------------------
select pg_temp.act_as_uid(gen_random_uuid());

-- грант select есть (authenticated), политики - нет: пусто, не ошибка.
select pg_temp.expect_count($$select 1 from public.rentals$$, 0);
select pg_temp.expect_count($$select 1 from public.rental_items$$, 0);
select pg_temp.expect_count($$select 1 from public.tool_units$$, 0);
select pg_temp.expect_error(
  format($$select public.issue_rental(%L, now() + interval '1 day', array[%L]::uuid[])$$,
    '00000000-0000-0000-0000-0000000004c1', '00000000-0000-0000-0000-0000000004a6'));

-- ---------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------
select pg_temp.act_as_anon();

-- В отличие от storage.objects (грант anon выдаёт Supabase), на
-- rentals/rental_items/tool_units anon гранта не имеет вовсе - отказ на
-- первом слое, до всякой политики.
select pg_temp.expect_error($$select 1 from public.rentals$$);
select pg_temp.expect_error($$select 1 from public.rental_items$$);
select pg_temp.expect_error($$select 1 from public.tool_units$$);
select pg_temp.expect_count(
  $$select 1 from storage.objects where bucket_id = 'rental-photos'$$,
  0);

rollback;
