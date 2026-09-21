-- =====================================================================
-- Проверка матрицы прав на staff и tools
--
-- Запуск:
--   SQL Editor: вставить целиком, Run. Дошёл до конца = всё прошло,
--     провал останавливает скрипт с текстом FAIL.
--   psql "$DB_URL" -f tests/policies/02_roles.sql - видны NOTICE по каждой проверке.
--
-- Предусловия: миграция этапа 2 применена, npm run seed:staff выполнен.
-- В базе ничего не остаётся: всё внутри транзакции с ROLLBACK,
-- вспомогательные функции в pg_temp исчезают вместе с ней.
-- =====================================================================
begin;

-- Войти как сотрудник: вернуться в postgres (чтобы прочитать auth.users),
-- положить sub в claims, переключиться в authenticated. Ровно то, что
-- PostgREST делает на каждый запрос.
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

-- Ожидаем ошибку с конкретным SQLSTATE. Внутренний begin/exception -
-- подтранзакция, эффект запроса откатывается.
create function pg_temp.expect_error(p_sql text, p_state text default '42501')
    returns void language plpgsql as $$
declare v_state text;
begin
begin
execute p_sql;
exception when others then
    v_state := sqlstate;
end;
  if v_state is null then
    raise exception 'FAIL: ожидалась ошибка %, запрос прошёл: %', p_state, p_sql;
  elsif v_state <> p_state then
    raise exception 'FAIL: ожидалась ошибка %, получена %: %', p_state, v_state, p_sql;
end if;
  raise notice 'ok [error %] %', p_state, p_sql;
end $$;

-- SELECT: ожидаемое число видимых строк.
create function pg_temp.expect_count(p_sql text, p_expected int)
    returns void language plpgsql as $$
declare v_count int;
begin
execute format('select count(*) from (%s) q', p_sql) into v_count;
if v_count <> p_expected then
    raise exception 'FAIL: ожидалось % строк, видно %: %', p_expected, v_count, p_sql;
end if;
  raise notice 'ok [% rows] %', v_count, p_sql;
end $$;

-- INSERT/UPDATE/DELETE: ожидаемое число затронутых строк.
create function pg_temp.expect_affected(p_sql text, p_expected int)
    returns void language plpgsql as $$
declare v_count int;
begin
execute p_sql;
get diagnostics v_count = row_count;
if v_count <> p_expected then
    raise exception 'FAIL: ожидалось % затронутых строк, получено %: %', p_expected, v_count, p_sql;
end if;
  raise notice 'ok [% affected] %', v_count, p_sql;
end $$;

-- Фикстура от имени postgres. Колонки сверь с миграцией этапа 1.
insert into public.tools (name, daily_rate, deposit_value) values ('__t2', 100, 1000);

-- ---------- OPERATOR ----------
select pg_temp.act_as('operator@example.com');
select pg_temp.expect_count($$select 1 from public.tools where name = '__t2'$$, 1);
select pg_temp.expect_error($$insert into public.tools (name, daily_rate, deposit_value) values ('__op', 1, 1)$$);
select pg_temp.expect_affected($$update public.tools set name = name where name = '__t2'$$, 0);
select pg_temp.expect_affected($$delete from public.tools where name = '__t2'$$, 0);
select pg_temp.expect_count($$select 1 from public.staff$$, 1);
select pg_temp.expect_affected($$update public.staff set role = 'SUPERADMIN' where user_id = auth.uid()$$, 0);
select pg_temp.expect_error($$insert into public.staff (user_id, full_name) values (gen_random_uuid(), 'x')$$);

-- ---------- MANAGER ----------
select pg_temp.act_as('manager@example.com');
select pg_temp.expect_affected($$insert into public.tools (name, daily_rate, deposit_value) values ('__mgr', 1, 1)$$, 1);
select pg_temp.expect_affected($$update public.tools set name = name where name = '__t2'$$, 1);
select pg_temp.expect_affected($$delete from public.tools where name = '__t2'$$, 0);
select pg_temp.expect_count($$select 1 from public.staff$$, 1);
select pg_temp.expect_error($$insert into public.staff (user_id, full_name) values (gen_random_uuid(), 'x')$$);

-- ---------- SUPERADMIN ----------
select pg_temp.act_as('admin@example.com');
select pg_temp.expect_count($$select 1 from public.staff where full_name like 'Тест %'$$, 3);
select pg_temp.expect_affected($$update public.staff set role = 'MANAGER' where full_name = 'Тест Оператор'$$, 1);
select pg_temp.expect_error($$update public.staff set role = 'MANAGER' where user_id = auth.uid()$$);
select pg_temp.expect_error($$update public.staff set is_active = false where user_id = auth.uid()$$);
select pg_temp.expect_affected($$delete from public.staff where user_id = auth.uid()$$, 0);
select pg_temp.expect_affected($$delete from public.tools where name = '__t2'$$, 1);

-- ---------- Деактивация действует сразу ----------
reset role;
update public.staff set is_active = false where full_name = 'Тест Менеджер';
select pg_temp.act_as('manager@example.com');
select pg_temp.expect_count($$select 1 from public.tools$$, 0);
select pg_temp.expect_count($$select 1 from public.staff$$, 1);  -- свою строку видит

-- ---------- anon: первый слой, до политик не доходит ----------
select pg_temp.act_as_anon();
select pg_temp.expect_error($$select 1 from public.tools$$);
select pg_temp.expect_error($$select 1 from public.staff$$);

rollback;