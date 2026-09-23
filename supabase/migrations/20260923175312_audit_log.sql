-- =====================================================================
-- Этап 6. Аудит-лог
--
-- Что делает:
--   1. Таблица audit_log: кто, когда, что, старое и новое значение.
--   2. Гранты и политика: писать не может никто, кроме триггера; читать -
--      только SUPERADMIN.
--   3. Универсальная триггерная функция audit_log_row() на несколько
--      таблиц - имя колонки первичного ключа передаётся аргументом
--      триггера.
--   4. Триггер на staff, tools, tool_units, customers, rentals,
--      rental_items, category_grace_periods.
--
-- Зависит от:
--   20260918094510_staff_and_roles.sql - public.staff_role,
--     current_staff_role()
--   20260921200621_customers_and_storage.sql - public.customers
--   20260923120539_tool_units_and_rentals.sql - public.tool_units,
--     public.rentals, public.rental_items
--   20260923152927_pricing_and_overdue.sql - public.category_grace_periods
--
-- Новое в этой миграции (подробно в docs/book/06-audit-log.md):
--   одна триггерная функция на несколько таблиц (TG_TABLE_NAME, TG_OP,
--   TG_ARGV, to_jsonb(row)); security definer ради гранта на запись,
--   которого нет ни у кого; auth.uid() внутри security definer -
--   личность вызывающего, а не роль исполнения; запрет записи двумя
--   независимыми слоями (грант и политика).
--
-- Как проверить:
--   psql "$DB_URL" -f tests/policies/06_audit.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Таблица audit_log
-- ---------------------------------------------------------------------

create table public.audit_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  actor_id       uuid,
  actor_role     public.staff_role,
  table_name     text not null,
  op             text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_pk         text not null,
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[]
);

comment on table public.audit_log is
  'Кто, когда и что изменил в ключевых таблицах. Пишет только триггер '
  'audit_log_row() (security definer) - ни у одной роли, включая '
  'service_role, нет гранта на запись. Читает только SUPERADMIN.';
comment on column public.audit_log.actor_id is
  'auth.uid() на момент действия. NULL - действие без пользователя '
  '(миграция, seed через service_role): auth.uid() тогда тоже NULL.';
comment on column public.audit_log.actor_role is
  'Снимок current_staff_role() вызывающего на момент действия, не роль '
  'владельца триггерной функции.';
comment on column public.audit_log.row_pk is
  'Значение первичного ключа изменённой строки, приведённое к text - '
  'у разных таблиц разный тип и разное имя колонки PK (аргумент '
  'триггера), общий столбец лога должен быть одного типа для всех.';
comment on column public.audit_log.changed_fields is
  'Только для UPDATE: какие колонки реально изменились (сравнение '
  'по jsonb, не по тексту). NULL для INSERT/DELETE. UPDATE, где ни одна '
  'колонка не изменилась (see docs/rls-notes.md про update of <col> '
  'по факту наличия в SET, не по факту изменения), в лог не попадает '
  'вообще - см. audit_log_row() ниже.';

-- (table_name, row_pk, at desc): история конкретной строки - открыть
-- карточку клиента/аренды и увидеть, что с ней происходило, по времени.
create index audit_log_table_row_at on public.audit_log (table_name, row_pk, at desc);
-- (actor_id, at desc): что делал конкретный сотрудник - раздел "Кто что
-- делал" в /audit и профиль сотрудника на будущих этапах.
create index audit_log_actor_at on public.audit_log (actor_id, at desc);


-- ---------------------------------------------------------------------
-- 1.1 Гранты и политика audit_log
-- ---------------------------------------------------------------------

-- Подробно: docs/book/06-audit-log.md, раздел "Запрет записи двумя
-- независимыми слоями".
-- Ни одна роль не грантована ни на insert, ни на update, ни на delete -
-- в том числе service_role: BYPASSRLS обходит только политики (тот же
-- урок, что и раньше в проекте), гранта это не заменяет. Пишет только
-- audit_log_row() ниже - security definer выполняется с правами
-- владельца функции (postgres), который владеет и этой таблицей, а
-- владельца таблицы гранты и RLS не касаются вовсе (нет FORCE ROW
-- LEVEL SECURITY).
revoke all on public.audit_log from anon, authenticated, service_role;
grant select on public.audit_log to authenticated;

alter table public.audit_log enable row level security;

-- SELECT, только SUPERADMIN.
-- Негатив: OPERATOR/MANAGER - пусто (грант select есть, политика не
--   пропускает ни одной строки); anon - 42501 (гранта нет вообще).
create policy "superadmin reads audit log" on public.audit_log
for select
to authenticated
using ((select public.current_staff_role()) = 'SUPERADMIN');

-- Политик на insert/update/delete нет - RLS включён, разрешений нет,
-- значит не проходит ничего (тот же принцип, что на этапе 1: "политика -
-- это разрешение, а не запрет"). Это второй, независимый от гранта,
-- слой: даже если бы кто-то по ошибке выдал грант на запись, RLS без
-- политики блокировала бы её так же надёжно. Негатив: SUPERADMIN,
-- insert/update/delete - 42501 на уровне гранта (грант не выдан ему
-- отдельно от остальных, см. revoke all выше) - политика до этого
-- дело не доходит вообще.


-- ---------------------------------------------------------------------
-- 2. Универсальная триггерная функция
-- ---------------------------------------------------------------------

-- Подробно: docs/book/06-audit-log.md, разделы "Одна функция на
-- несколько таблиц" и "auth.uid() внутри security definer".
-- security definer: authenticated (и вообще никто, кроме postgres) не
--   имеет гранта на insert в audit_log - без security definer вставка
--   падала бы с 42501 сразу после успешного изменения основной строки.
-- auth.uid() внутри security definer по-прежнему возвращает вызывающего:
--   функция читает GUC request.jwt.claims, установленный один раз на
--   всю сессию PostgREST, а не current_user (SQL-роль исполнения). Из
--   этого следует ключевое свойство лога: когда rental_items_sync_unit
--   (тоже security definer, этап 4) от имени оператора обновляет
--   tool_units.status, наш триггер на tool_units видит auth.uid()
--   того же оператора, а не postgres - показано тестом
--   tests/policies/06_audit.sql.
-- volatile (по умолчанию): пишет, кешировать нечего.
-- search_path = '': полные имена объектов.
-- TG_ARGV[0] - имя колонки первичного ключа таблицы, на которой стоит
--   конкретный триггер (аргумент из create trigger ниже). Используется
--   только как ключ в jsonb (`->>`), не как часть SQL-текста - никакой
--   динамической SQL-строки здесь нет и инъекция невозможна в принципе.
create function public.audit_log_row()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
  v_old_data       jsonb := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) else null end;
  v_new_data       jsonb := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) else null end;
  v_changed_fields text[];
  v_actor_role     public.staff_role;
begin
  if TG_OP = 'UPDATE' then
    -- Сравнение по jsonb, не по тексту: одинаковое значение сериализуется
    -- в jsonb одинаково независимо от форматирования, в отличие от
    -- текстового представления. array_agg без совпавших строк даёт NULL,
    -- а не пустой массив - этим отличаем "ничего не изменилось" от
    -- "изменилась ровно одна колонка".
    select array_agg(n.key order by n.key)
      into v_changed_fields
    from jsonb_each(v_new_data) as n(key, value)
    where n.value is distinct from v_old_data -> n.key;

    -- UPDATE ... SET status = status (тот же приём, что в upsert сида,
    -- разобранный для tool_units_guard_status на этапе 4) не меняет ни
    -- одной колонки - такой UPDATE в лог не попадает вообще, иначе сид
    -- при каждом повторном запуске плодил бы записи ни о чём.
    if v_changed_fields is null then
      return null;
    end if;
  end if;

  v_actor_role := public.current_staff_role();

  insert into public.audit_log (actor_id, actor_role, table_name, op, row_pk, old_data, new_data, changed_fields)
  values (
    auth.uid(),
    v_actor_role,
    TG_TABLE_NAME,
    TG_OP,
    coalesce(v_new_data, v_old_data) ->> TG_ARGV[0],
    v_old_data,
    v_new_data,
    v_changed_fields
  );

  -- Возврат не используется приложением (after-триггер), но по
  -- соглашению after-триггер, ничего не делающий с результатом изменения
  -- строки, возвращает NULL, а завершившийся успешно - саму строку.
  return coalesce(NEW, OLD);
end;
$$;

comment on function public.audit_log_row() is
  'Универсальный after-триггер аудита: одна функция на несколько таблиц, '
  'имя колонки PK - первый аргумент триггера (TG_ARGV[0]). security '
  'definer - у вызывающего нет гранта на запись в audit_log.';


-- ---------------------------------------------------------------------
-- 3. Триггеры на аудируемых таблицах
-- ---------------------------------------------------------------------

-- after insert or update or delete, без "of <col>": в отличие от
-- триггеров этапов 3-5, аудит должен видеть вообще любое изменение
-- строки, а не только конкретную колонку. for each row - лог построчный,
-- у одного statement на несколько строк должно быть по записи на строку.
-- Аргумент - имя колонки первичного ключа этой конкретной таблицы: у
-- staff это user_id, у category_grace_periods - category, у остальных -
-- id (разное имя и то, что у customer_grace_periods это не uuid, а
-- значение enum - ровно то, ради чего row_pk хранится как text, а не
-- как uuid).
create trigger audit_staff
    after insert or update or delete on public.staff
    for each row
    execute function public.audit_log_row('user_id');

create trigger audit_tools
    after insert or update or delete on public.tools
    for each row
    execute function public.audit_log_row('id');

-- На tool_units уже есть один before-триггер (tool_units_guard_status,
-- update of status). Наш триггер - after, не before, поэтому вопрос их
-- взаимного алфавитного порядка не встаёт: before всегда раньше after,
-- независимо от имени (та же оговорка, что у rental_items_sync_unit
-- в главе 04).
create trigger audit_tool_units
    after insert or update or delete on public.tool_units
    for each row
    execute function public.audit_log_row('id');

-- На customers уже есть один before-триггер (customers_guard_category,
-- update of category) - та же оговорка про фазы, что и у tool_units выше.
create trigger audit_customers
    after insert or update or delete on public.customers
    for each row
    execute function public.audit_log_row('id');

-- На rentals уже два before-триггера (rentals_guard_customer,
-- rentals_set_grace_hours, оба insert) - опять же before, наш - after,
-- порядок между фазами не пересекается.
create trigger audit_rentals
    after insert or update or delete on public.rentals
    for each row
    execute function public.audit_log_row('id');

-- На rental_items уже есть один before (rental_items_set_return,
-- update of returned_at), один after на другое событие
-- (rental_items_set_return_amount, тоже before на самом деле - оба
-- расчётных триггера этапа 5 before) и один after
-- (rental_items_sync_unit, insert or update of returned_at). Наш
-- триггер - after insert or update or delete, без ограничения "of
-- returned_at" - события пересекаются с rental_items_sync_unit
-- (оба сработают на insert и на update of returned_at). Порядок между
-- ними не важен: rental_items_sync_unit пишет в tool_units/rentals
-- (что само по себе поднимет их собственные audit-триггеры), а этот
-- триггер читает только NEW/OLD текущей строки rental_items - они не
-- читают результат друг друга.
create trigger audit_rental_items
    after insert or update or delete on public.rental_items
    for each row
    execute function public.audit_log_row('id');

-- На category_grace_periods других триггеров нет.
create trigger audit_category_grace_periods
    after insert or update or delete on public.category_grace_periods
    for each row
    execute function public.audit_log_row('category');
