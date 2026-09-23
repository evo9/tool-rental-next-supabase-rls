-- =====================================================================
-- Проверка политик этапа 3: public.customers и storage.objects
-- (бакет customer-photos).
--
-- Требует: применённую миграцию customers_and_storage и пользователей
--   из npm run seed:staff.
-- Запуск: целиком в SQL Editor (отработал без ошибки = всё прошло)
--   или psql "<строка из Connect>" -f tests/policies/03_customers.sql
-- Все тестовые телефоны начинаются с +38000000000, чтобы не пересекаться
-- с реальными данными.
-- =====================================================================

begin;

-- --- вспомогательные функции -----------------------------------------

-- Залогиненный пользователь с данным uuid (может не быть сотрудником).
create function pg_temp.act_as_uid(p_uid uuid) returns void
    language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
set local role authenticated;
end $$;

-- Сотрудник из seed по email.
create function pg_temp.act_as(p_email text) returns void
    language plpgsql as $$
declare v_id uuid;
begin
  reset role;
select id into v_id from auth.users where email = p_email;
if v_id is null then
    raise exception 'FAIL: нет пользователя %', p_email;
end if;
  perform pg_temp.act_as_uid(v_id);
end $$;

-- Запрос без сессии.
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
-- 23505 вместо 42501 значит, что до политики дело не дошло.
-- raise 'FAIL' стоит после блока: внутри begin его перехватил бы
-- собственный exception.
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

-- --- тестовые данные (postgres, мимо RLS) ----------------------------

insert into public.customers (id, full_name, phone) values
                                                        ('00000000-0000-0000-0000-0000000000c1', 'Тест Один', '+380000000001'),
                                                        ('00000000-0000-0000-0000-0000000000c2', 'Тест Два',  '+380000000002');

-- --- OPERATOR --------------------------------------------------------

select pg_temp.act_as('operator@example.com');

-- видит клиентов
select pg_temp.expect_count(
               $$select 1 from public.customers where phone like '+38000000000%'$$, 2);

-- регистрирует клиента с базовой категорией
select pg_temp.expect_affected(
               $$insert into public.customers (full_name, phone) values ('Тест Три', '+380000000003')$$, 1);

-- не может сразу назначить категорию выше базовой (WITH CHECK на INSERT)
select pg_temp.expect_error(
               $$insert into public.customers (full_name, phone, category)
    values ('Тест Четыре', '+380000000004', 'GOLD')$$);

-- правит данные карточки
select pg_temp.expect_affected(
               $$update public.customers set full_name = 'Тест Один Исправлен'
    where id = '00000000-0000-0000-0000-0000000000c1'$$, 1);

-- не меняет категорию (триггер)
select pg_temp.expect_error(
               $$update public.customers set category = 'PLATINUM'
    where id = '00000000-0000-0000-0000-0000000000c1'$$);

-- не меняет created_at (нет гранта на колонку)
select pg_temp.expect_error(
               $$update public.customers set created_at = now()
    where id = '00000000-0000-0000-0000-0000000000c1'$$);

-- не удаляет (нет гранта DELETE)
select pg_temp.expect_error(
               $$delete from public.customers where id = '00000000-0000-0000-0000-0000000000c1'$$);

-- не привязывает к карточке файл из папки другого клиента (check)
select pg_temp.expect_error(
               $$update public.customers
    set photo_path = '00000000-0000-0000-0000-0000000000c2/photo.jpg'
    where id = '00000000-0000-0000-0000-0000000000c1'$$, '23514');

-- привязывает файл из своей папки
select pg_temp.expect_affected(
               $$update public.customers
    set photo_path = '00000000-0000-0000-0000-0000000000c1/photo-test.jpg'
    where id = '00000000-0000-0000-0000-0000000000c1'$$, 1);

-- Storage: загружает в папку существующего клиента
select pg_temp.expect_affected(
               $$insert into storage.objects (bucket_id, name)
    values ('customer-photos', '00000000-0000-0000-0000-0000000000c1/photo-test.jpg')$$, 1);

-- не загружает в корень бакета
select pg_temp.expect_error(
               $$insert into storage.objects (bucket_id, name)
    values ('customer-photos', 'photo-test.jpg')$$);

-- не загружает в папку несуществующего клиента
select pg_temp.expect_error(
               $$insert into storage.objects (bucket_id, name)
    values ('customer-photos', '00000000-0000-0000-0000-00000000dead/photo.jpg')$$);

-- видит загруженный объект
select pg_temp.expect_count(
               $$select 1 from storage.objects
    where bucket_id = 'customer-photos'
      and name like '00000000-0000-0000-0000-0000000000c1/%'$$, 1);

-- --- MANAGER ---------------------------------------------------------

select pg_temp.act_as('manager@example.com');

-- регистрирует клиента сразу с категорией
select pg_temp.expect_affected(
               $$insert into public.customers (full_name, phone, category)
    values ('Тест Четыре', '+380000000004', 'GOLD')$$, 1);

-- меняет категорию
select pg_temp.expect_affected(
               $$update public.customers set category = 'NON_GRATA'
    where id = '00000000-0000-0000-0000-0000000000c1'$$, 1);

-- --- SUPERADMIN ------------------------------------------------------

select pg_temp.act_as('admin@example.com');

-- меняет категорию (роль выше MANAGER)
select pg_temp.expect_affected(
               $$update public.customers set category = 'GOLD'
    where id = '00000000-0000-0000-0000-0000000000c2'$$, 1);

-- тоже не удаляет: DELETE не выдан никому
select pg_temp.expect_error(
               $$delete from public.customers where id = '00000000-0000-0000-0000-0000000000c2'$$);

-- --- залогиненный, но не сотрудник ----------------------------------

select pg_temp.act_as_uid(gen_random_uuid());

select pg_temp.expect_count(
               $$select 1 from public.customers where phone like '+38000000000%'$$, 0);

select pg_temp.expect_error(
               $$insert into public.customers (full_name, phone) values ('Чужой', '+380000000009')$$);

-- USING не пропустил: 0 строк, без ошибки
select pg_temp.expect_affected(
               $$update public.customers set full_name = 'Взлом'
    where id = '00000000-0000-0000-0000-0000000000c2'$$, 0);

select pg_temp.expect_count(
               $$select 1 from storage.objects where bucket_id = 'customer-photos'$$, 0);

select pg_temp.expect_error(
               $$insert into storage.objects (bucket_id, name)
    values ('customer-photos', '00000000-0000-0000-0000-0000000000c2/x.jpg')$$);

-- --- anon ------------------------------------------------------------

select pg_temp.act_as_anon();

-- на customers у anon нет гранта: отказ на первом слое
select pg_temp.expect_error($$select 1 from public.customers$$);

-- на storage.objects грант у anon есть (его выдал Supabase),
-- но нет политики: пусто, а не ошибка
select pg_temp.expect_count(
               $$select 1 from storage.objects where bucket_id = 'customer-photos'$$, 0);

rollback;