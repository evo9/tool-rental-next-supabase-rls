-- =====================================================================
-- Проверка политик и триггеров этапа 5: public.category_grace_periods,
-- снимки rentals.grace_hours/rental_items.daily_rate, начисление
-- rental_items.amount при возврате, public.rental_estimate().
--
-- Предусловия: миграции этапов 1-5 применены, npm run seed:staff
--   выполнен (нужны operator@example.com, manager@example.com).
-- Запуск:
--   SQL Editor: вставить целиком, Run. Дошёл до конца = всё прошло,
--     провал останавливает скрипт с текстом FAIL.
--   psql "$DB_URL" -f tests/policies/05_pricing.sql - видны NOTICE по
--     каждой проверке.
-- В базе ничего не остаётся: всё внутри транзакции с ROLLBACK.
--
-- Чистая арифметика calc_rental_amount() (граничные случаи формулы) -
-- отдельно, tests/pricing/05_calc.sql: этот файл проверяет только то,
-- что зависит от ролей, RLS и триггеров - кто может что записать и чей
-- снимок в итоге используется.
-- =====================================================================
begin;

-- --- вспомогательные функции (тот же формат, что в 04_rentals.sql) ----

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

-- --- вспомогательные функции этого файла: захват результата
-- issue_rental() и путь к фото возврата (тот же приём, что в
-- 04_rentals.sql) -------------------------------------------------------

create table pg_temp.rental_tariff (rental_id uuid, rental_item_id uuid, tool_unit_id uuid);
grant select, insert on pg_temp.rental_tariff to authenticated;

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
  ('00000000-0000-0000-0000-0000000005f0', '__Тест Тариф', 100, 1000);

insert into public.tool_units (id, tool_id, inventory_number, status) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005f0', '__INV-P1', 'AVAILABLE'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005f0', '__INV-P2', 'AVAILABLE');

insert into public.customers (id, full_name, phone, category) values
  ('00000000-0000-0000-0000-0000000005c1', 'Тест Клиент Тариф', '+380000000511', 'GOLD');

-- Аренда 05b1 вставлена напрямую (postgres, мимо RLS) с управляемыми
-- issued_at/planned_return_at - только так можно детерминированно
-- получить known просрочку (1 сутки сверх grace) без pg_sleep и без
-- зависимости от скорости выполнения самого теста: planned_return_at
-- на сутки в прошлом относительно issued_at, а не относительно момента
-- запуска теста, поэтому разница planned - issued (нужна для base_days)
-- точна до микросекунды независимо от того, сколько реально займёт файл.
-- created_by указан явно: как postgres, default auth.uid() дал бы NULL
-- (нет request.jwt.claims), а колонка not null.
insert into public.rentals (id, customer_id, created_by, issued_at, planned_return_at)
values (
  '00000000-0000-0000-0000-0000000005b1',
  '00000000-0000-0000-0000-0000000005c1',
  (select id from auth.users where email = 'operator@example.com'),
  now() - interval '3 days',
  now() - interval '1 day'
);

insert into public.rental_items (id, rental_id, tool_unit_id)
values (
  '00000000-0000-0000-0000-0000000005d1',
  '00000000-0000-0000-0000-0000000005b1',
  '00000000-0000-0000-0000-0000000005a1'
);

-- Снимок grace_hours поставлен триггером rentals_set_grace_hours по
-- категории GOLD (12 ч) уже на вставке - фиксируем это до того, как
-- менеджер попробует изменить grace категории ниже.
select pg_temp.expect_count(
  $$select 1 from public.rentals
    where id = '00000000-0000-0000-0000-0000000005b1' and grace_hours = 12$$,
  1);

-- ---------------------------------------------------------------------
-- OPERATOR
-- ---------------------------------------------------------------------
select pg_temp.act_as('operator@example.com');

-- позитив: оператор возвращает позицию 05d1 - amount посчитан.
-- issued_at = now()-3d, planned_return_at = now()-1d (обе даты
-- зафиксированы при вставке фикстуры), возврат происходит прямо сейчас:
-- base_days = ceil((planned - issued) / 24ч) = ceil(2d/24ч) = 2
-- (planned уже в прошлом, значит least(returned, planned) = planned);
-- overdue = (returned - planned) - grace ~= 1d - 12ч = 12ч (плюс доли
-- секунды на выполнение теста, не влияющие на округление в сутках) ->
-- overdue_days = ceil(~12ч/24ч) = 1. Итог: (2 + 1) * 100 = 300.00.
select pg_temp.expect_affected(
  pg_temp.return_one(
    '00000000-0000-0000-0000-0000000005d1',
    pg_temp.photo_path('00000000-0000-0000-0000-0000000005b1',
      '00000000-0000-0000-0000-0000000005d1', 'return')
  ),
  1);
select pg_temp.expect_count(
  $$select 1 from public.rental_items
    where id = '00000000-0000-0000-0000-0000000005d1' and amount = 300.00$$,
  1);

-- выдача второй единицы - пригодится ниже для сценария смены тарифа
-- модели после выдачи. planned через 5 суток: возврат почти сразу же
-- после выдачи не создаёт просрочки, amount = 1 * daily_rate ровно.
insert into pg_temp.rental_tariff (rental_id, rental_item_id, tool_unit_id)
select rental_id, rental_item_id, tool_unit_id from public.issue_rental(
  '00000000-0000-0000-0000-0000000005c1',
  now() + interval '5 days',
  array['00000000-0000-0000-0000-0000000005a2']::uuid[]
);
select pg_temp.expect_count(
  format($$select 1 from public.rental_items
    where id = %L and daily_rate = 100.00$$,
    pg_temp.item_in('pg_temp.rental_tariff', '00000000-0000-0000-0000-0000000005a2')),
  1);

-- негатив: оператор пишет amount, daily_rate или grace_hours напрямую -
-- ни одна из трёх колонок не входит ни в один UPDATE-грант этой роли на
-- rentals/rental_items (сравни с грантом "issue_photo_path,
-- returned_at, return_photo_path" на rental_items в главе 04) - отказ
-- на первом слое, до всякой политики.
select pg_temp.expect_error(
  $$update public.rental_items set amount = 1
    where id = '00000000-0000-0000-0000-0000000005d1'$$);
select pg_temp.expect_error(
  format($$update public.rental_items set daily_rate = 1 where id = %L$$,
    pg_temp.item_in('pg_temp.rental_tariff', '00000000-0000-0000-0000-0000000005a2')));
select pg_temp.expect_error(
  $$update public.rentals set grace_hours = 1
    where id = '00000000-0000-0000-0000-0000000005b1'$$);

-- ---------------------------------------------------------------------
-- MANAGER
-- ---------------------------------------------------------------------
select pg_temp.act_as('manager@example.com');

-- менеджер меняет тариф модели уже после выдачи позиции 05a2 (снимок
-- daily_rate = 100 в rental_items уже стоит) - проверка, что снимок,
-- а не текущий tools.daily_rate, используется при возврате, идёт ниже,
-- снова под OPERATOR.
select pg_temp.expect_affected(
  $$update public.tools set daily_rate = 999
    where id = '00000000-0000-0000-0000-0000000005f0'$$,
  1);

-- менеджер меняет grace period категории GOLD - у уже выданной аренды
-- 05b1 grace_hours не должен измениться: это снимок, а не текущее
-- значение таблицы.
select pg_temp.expect_affected(
  $$update public.category_grace_periods set grace_hours = 48
    where category = 'GOLD'$$,
  1);
select pg_temp.expect_count(
  $$select 1 from public.rentals
    where id = '00000000-0000-0000-0000-0000000005b1' and grace_hours = 12$$,
  1);

-- позитив: rental_estimate менеджеру - для уже закрытой позиции 05d1
-- отдаёт сохранённый amount и расшифровку по дням, не пересчитывает
-- заново по текущим (уже изменённым выше) тарифу и grace.
select pg_temp.expect_count(
  format($$select 1 from public.rental_estimate(%L)
    where rental_item_id = %L and base_days = 2 and overdue_days = 1
      and amount = 300.00 and is_returned$$,
    '00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-0000000005d1'),
  1);

-- ---------------------------------------------------------------------
-- OPERATOR: возврат по старому тарифу
-- ---------------------------------------------------------------------
select pg_temp.act_as('operator@example.com');

-- позитив: возврат позиции 05a2 - сумма посчитана по тарифу, снятому
-- при выдаче (100), а не по текущему tools.daily_rate (999, менеджер
-- поменял выше). Возврат почти сразу после выдачи, планового срока
-- (+5 суток) ещё далеко - просрочки нет, amount = 1 * 100 = 100.00.
select pg_temp.expect_affected(
  pg_temp.return_one(
    pg_temp.item_in('pg_temp.rental_tariff', '00000000-0000-0000-0000-0000000005a2'),
    pg_temp.photo_path(pg_temp.rental_of('pg_temp.rental_tariff'),
      pg_temp.item_in('pg_temp.rental_tariff', '00000000-0000-0000-0000-0000000005a2'), 'return')
  ),
  1);
select pg_temp.expect_count(
  format($$select 1 from public.rental_items where id = %L and amount = 100.00$$,
    pg_temp.item_in('pg_temp.rental_tariff', '00000000-0000-0000-0000-0000000005a2')),
  1);

-- негатив: оператор меняет category_grace_periods. Грант на update
-- (grace_hours) выдан любому authenticated (раздел 1 миграции этапа 5,
-- тот же приём, что у tools в главе 02), но политика "manager+ can
-- update grace periods" требует роль MANAGER+ - USING не пропускает
-- строку, значит 0 затронутых строк, а не ошибка (грант есть, дело не
-- дошло до записи только на уровне политики).
select pg_temp.expect_affected(
  $$update public.category_grace_periods set grace_hours = 50
    where category = 'SILVER'$$,
  0);

-- ---------------------------------------------------------------------
-- Залогинен, но нет строки в staff
-- ---------------------------------------------------------------------
select pg_temp.act_as_uid(gen_random_uuid());

-- негатив: rental_estimate от пользователя без staff - пусто, не
-- ошибка. Доказательство, что внутри функции реально работает RLS
-- вызывающего (security invoker), а не отдельная ручная проверка роли:
-- политики "staff can read rentals"/"staff can read rental items" не
-- пропускают этому вызывающему ни одной строки, соединение в
-- rental_estimate возвращает пустой набор.
select pg_temp.expect_count(
  format($$select 1 from public.rental_estimate(%L)$$,
    '00000000-0000-0000-0000-0000000005b1'),
  0);

-- ---------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------
select pg_temp.act_as_anon();

-- негатив: rental_estimate от anon - 42501 на execute, отказ ещё до
-- того, как дело дошло бы до RLS внутри функции (execute на функцию
-- отозван у public и anon, выдан только authenticated).
select pg_temp.expect_error(
  format($$select public.rental_estimate(%L)$$,
    '00000000-0000-0000-0000-0000000005b1'));

rollback;
