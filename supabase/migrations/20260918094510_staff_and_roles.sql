-- =====================================================================
-- Роли сотрудников и матрица прав на уровне политик
--
-- Что делает:
--   1. Тип public.staff_role: OPERATOR < MANAGER < SUPERADMIN (порядок значим).
--   2. Таблица public.staff: какой пользователь auth.users является
--      сотрудником и с какой ролью.
--   3. Функция public.current_staff_role(): единственная точка, из которой
--      политики берут роль вызывающего.
--   4. Гранты и политики на staff.
--   5. Замена временной политики этапа 1 на tools политиками по матрице прав.
--
-- Зависит от:
--   миграции этапа 1: public.tools с включённым RLS
--   и политикой "authenticated can read tools".
--
-- Как проверить:
--   1. npm run seed:staff - три тестовых сотрудника.
--   2. tests/policies/02_roles.sql - должен дойти до конца без FAIL.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Тип роли
-- ---------------------------------------------------------------------
-- enum, а не text + check:
--   - Postgres сравнивает значения enum по порядку объявления. Роли
--     иерархичны (каждая следующая умеет всё, что предыдущая), поэтому
--     политика пишет "роль >= 'MANAGER'" вместо перечисления ролей.
--     Новая промежуточная роль добавляется через
--     ALTER TYPE ... ADD VALUE ... BEFORE, существующие политики не трогаются.
--   - supabase gen types превращает enum в TS-union, опечатку в роли
--     ловит компилятор.
-- Цена: удалить значение из enum можно только пересозданием типа.
create type public.staff_role as enum ('OPERATOR', 'MANAGER', 'SUPERADMIN');

comment on type public.staff_role is
  'Роль сотрудника. Порядок значений = иерархия прав, политики сравнивают через >=.';


-- ---------------------------------------------------------------------
-- 2. Сотрудники
-- ---------------------------------------------------------------------
create table public.staff (
    -- PK и FK одновременно: у пользователя Auth не больше одной строки сотрудника.
    -- on delete restrict: сотрудника не удаляют, а деактивируют. Позже на staff
    -- сошлются аренды и аудит, и удаление пользователя в Auth не должно
    -- молча стереть, кто оформлял выдачу.
                              user_id    uuid primary key references auth.users (id) on delete restrict,
                              full_name  text not null check (btrim(full_name) <> ''),
    -- Дефолт - минимальная роль: забытое поле не должно давать лишних прав.
                              role       public.staff_role not null default 'OPERATOR',
                              is_active  boolean not null default true,
                              created_at timestamptz not null default now()
);

comment on table public.staff is
  'Сотрудники точки проката. Активная строка = доступ к системе. Строки создаёт SUPERADMIN (первого - seed-скрипт через service_role), самостоятельной регистрации нет.';
comment on column public.staff.is_active is
  'false = доступ отозван: current_staff_role() возвращает NULL, политики перестают пропускать. Действует со следующего запроса, перелогин не нужен.';


-- ---------------------------------------------------------------------
-- 3. Роль текущего пользователя
-- ---------------------------------------------------------------------
-- Зачем функция, а не подзапрос в политике: политикам на самой staff тоже
--   нужна роль. Подзапрос к staff внутри политики на staff снова включает
--   RLS на staff -> бесконечная рекурсия, ошибка 42P17.
--
-- security definer: выполняется с правами владельца функции (postgres).
--   postgres владеет таблицей staff, а к владельцу таблицы RLS не
--   применяется (нет FORCE ROW LEVEL SECURITY). Поэтому чтение staff внутри
--   функции идёт мимо политик и рекурсии нет. Чужие данные при этом
--   не утекают: функция отдаёт только роль вызывающего (фильтр по auth.uid()).
--
-- stable: без записи, в пределах запроса результат одинаков. Это разрешает
--   планировщику вычислить функцию один раз, но не обязывает. Гарантию
--   "один раз на запрос" даёт обёртка (select public.current_staff_role())
--   в политиках: она превращается в InitPlan.
--
-- set search_path = '': security definer функция с путём поиска вызывающего
--   уязвима - объект с именем staff, созданный в схеме раньше public,
--   был бы прочитан с правами postgres. Пустой путь и полные имена
--   (public.staff, auth.uid) закрывают это целиком.
--
-- Имя: current_role - зарезервированное слово SQL (имя Postgres-роли,
--   у нас 'authenticated'), поэтому current_staff_role.
--
-- NULL на выходе = не сотрудник или деактивирован. Сравнение с NULL даёт
--   NULL, политика считает это false.
create function public.current_staff_role()
    returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
select s.role
from public.staff s
where s.user_id = auth.uid()
  and s.is_active
    $$;

comment on function public.current_staff_role() is
  'Роль вызывающего сотрудника или NULL. Единственный источник роли для политик.';

-- Supabase по умолчанию выдаёт execute на новые функции anon и authenticated.
-- anon функция не нужна. authenticated нужен execute, потому что политики
-- вызывают функцию с правами вызывающего. Побочный эффект полезен: фронт
-- может узнать свою роль через supabase.rpc('current_staff_role').
revoke execute on function public.current_staff_role() from public, anon;
grant execute on function public.current_staff_role() to authenticated;


-- ---------------------------------------------------------------------
-- 4. staff: гранты и политики
-- ---------------------------------------------------------------------
-- Первый слой: anon к staff не прикасается, получает 42501 до всяких политик.
-- authenticated получает все операции на уровне таблицы, что из этого
-- разрешено конкретной роли - решают политики.
revoke all on public.staff from anon;
grant select, insert, update, delete on public.staff to authenticated;

alter table public.staff enable row level security;

-- SELECT, любой вошедший: своя строка.
-- USING: строка принадлежит вызывающему. Нужна интерфейсу для имени и роли
--   в шапке. Деактивированный тоже видит свою строку, чтобы интерфейс мог
--   показать "доступ отключён" вместо пустых экранов.
-- Вместе со следующей политикой объединяется через OR.
-- Негатив: OPERATOR, select from staff -> ровно 1 строка, своя.
create policy "staff: read own row"
on public.staff for select
                               to authenticated
                               using (user_id = (select auth.uid()));

-- SELECT, SUPERADMIN: все строки.
-- Негатив: MANAGER, select from staff -> 1 строка, чужих не видно.
create policy "staff: superadmin reads all"
on public.staff for select
                               to authenticated
                               using ((select public.current_staff_role()) = 'SUPERADMIN');

-- INSERT, SUPERADMIN.
-- WITH CHECK: условие не зависит от содержимого строки, важна только роль
--   вызывающего. Роль нового сотрудника может быть любой.
-- Негатив: OPERATOR и MANAGER, insert -> ошибка 42501. INSERT при провале
--   политики всегда ошибка: фильтровать нечего, есть только новая строка.
create policy "staff: superadmin inserts"
on public.staff for insert
to authenticated
with check ((select public.current_staff_role()) = 'SUPERADMIN');

-- UPDATE, SUPERADMIN.
-- USING (старая строка): менять может только суперадмин, любую строку.
-- WITH CHECK (новая строка): суперадмин не может понизить или деактивировать
--   сам себя. Иначе последний суперадмин одним запросом запирает систему,
--   и доступ возвращается только через service_role. Пока никто не может
--   снять права с себя, хотя бы один активный суперадмин остаётся всегда.
--   Здесь видно, зачем USING и WITH CHECK разделены: своя строка проходит
--   USING, но её новая версия с role = 'MANAGER' не проходит WITH CHECK.
-- Негатив: OPERATOR, update своей строки set role = 'SUPERADMIN' -> 0 строк
--   (USING не пропустил, ошибки нет). SUPERADMIN, update своей строки
--   set role = 'MANAGER' -> ошибка 42501.
create policy "staff: superadmin updates"
on public.staff for update
                                      to authenticated
                                      using ((select public.current_staff_role()) = 'SUPERADMIN')
                    with check (
                                      (select public.current_staff_role()) = 'SUPERADMIN'
                                      and (
                                      user_id <> (select auth.uid())
                                      or (role = 'SUPERADMIN' and is_active)
                                      )
                                      );

-- DELETE, SUPERADMIN, кроме своей строки (та же защита от самоблокировки).
-- Штатный путь - деактивация. Удаление нужно для ошибочно созданных строк;
-- строки с историей позже защитит FK из аренд.
-- Негатив: MANAGER, delete -> 0 строк. SUPERADMIN, delete своей -> 0 строк.
create policy "staff: superadmin deletes others"
on public.staff for delete
to authenticated
using (
  (select public.current_staff_role()) = 'SUPERADMIN'
  and user_id <> (select auth.uid())
);


-- ---------------------------------------------------------------------
-- 5. tools: матрица прав
-- ---------------------------------------------------------------------
-- Политика этапа 1 using (true) пускала любого пользователя Auth, даже без
-- строки в staff. Заменяем.
drop policy if exists "authenticated can read tools" on public.tools;

-- После revoke anon получает 42501 вместо пустого массива этапа 1:
-- закрыт первый слой, до политик дело не доходит.
revoke all on public.tools from anon;
grant select, insert, update, delete on public.tools to authenticated;

-- SELECT, любой активный сотрудник.
-- USING: у вызывающего есть активная строка в staff.
-- Негатив: деактивированный OPERATOR -> 0 строк. anon -> 42501.
create policy "tools: staff reads"
on public.tools for select
                               to authenticated
                               using ((select public.current_staff_role()) is not null);

-- INSERT, MANAGER и выше (сравнение по порядку enum).
-- Негатив: OPERATOR, insert -> ошибка 42501.
create policy "tools: manager+ inserts"
on public.tools for insert
to authenticated
with check ((select public.current_staff_role()) >= 'MANAGER');

-- UPDATE, MANAGER и выше.
-- USING и WITH CHECK совпадают: право зависит от роли, не от строки.
-- Без WITH CHECK Postgres применил бы USING и к новой строке, но явная
-- запись читается без знания этого правила.
-- Негатив: OPERATOR, update -> 0 строк.
create policy "tools: manager+ updates"
on public.tools for update
                                      to authenticated
                                      using ((select public.current_staff_role()) >= 'MANAGER')
                    with check ((select public.current_staff_role()) >= 'MANAGER');

-- DELETE, только SUPERADMIN. Менеджер выводит единицы из оборота статусом
-- WRITTEN_OFF на tool_units (этап 4), физическое удаление модели - действие
-- суперадмина.
-- Негатив: MANAGER, delete -> 0 строк.
create policy "tools: superadmin deletes"
on public.tools for delete
to authenticated
using ((select public.current_staff_role()) = 'SUPERADMIN');