-- =====================================================================
-- Этап 4. Аренда: выдача и возврат (часть 1 из 2)
--
-- Что делает:
--   1. Таблица tool_units (её ещё не было) - физические единицы
--      инструмента.
--   2. Таблица rentals - аренда: клиент, кто выдал, плановый возврат.
--   3. Таблица rental_items - позиция аренды: одна единица в одной
--      аренде, запрет повторной активной выдачи той же единицы, фото
--      выдачи и возврата.
--   4. Триггеры, которые держат статус tool_units и rentals в согласии
--      с фактическими данными rental_items, и не дают подделать время
--      возврата.
--
-- Зависит от:
--   20260917211501_create_tools.sql - public.tools
--   20260918094510_staff_and_roles.sql - public.staff_role,
--                                         current_staff_role()
--   20260921200621_customers_and_storage.sql - public.customers,
--                                               public.customer_category
--
-- Новое в этой миграции (подробно в docs/book/04-rentals.md):
--   частичный уникальный индекс на активную позицию аренды;
--   security definer в триггерной функции, которая пишет в чужие
--   таблицы; статус единицы как производная от данных, а не от флага;
--   принудительное время в триггере; порядок срабатывания нескольких
--   before-триггеров на одной таблице.
--
-- RPC для выдачи и возврата - в следующей миграции (часть 2 из 2):
--   прямая вставка тех же строк через PostgREST, минуя RPC, даёт тот же
--   результат - все правила держат гранты, политики и триггеры этой
--   миграции, а не сама функция.
--
-- Как проверить:
--   psql "$DB_URL" -f tests/policies/04_rentals.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Единицы инструмента
-- ---------------------------------------------------------------------

-- Порядок значений не используется для сравнения (в отличие от
-- staff_role): переходы между статусами держит триггер ниже по графу
-- допустимых переходов, а не диапазоном "меньше/больше".
create type public.tool_unit_status as enum (
  'AVAILABLE',
  'RENTED',
  'UNAVAILABLE',
  'WRITTEN_OFF'
);

comment on type public.tool_unit_status is
  'Статус физической единицы инструмента. Переходы держит триггер '
  'tool_units_guard_status, приложение это поле напрямую не решает.';

create table public.tool_units (
  id               uuid primary key default gen_random_uuid(),
  -- on delete restrict: модель с уже заведёнными единицами не удалить -
  -- сначала единицы нужно списать (WRITTEN_OFF) или перепривязать.
  tool_id          uuid not null references public.tools (id) on delete restrict,
  inventory_number text not null unique,
  status           public.tool_unit_status not null default 'AVAILABLE',
  note             text,
  created_at       timestamptz not null default now(),

  constraint tool_units_inventory_number_not_blank
    check (btrim(inventory_number) <> '')
);

comment on table public.tool_units is
  'Физическая единица инструмента модели tools. Статус - производная '
  'от данных rental_items (tool_units_guard_status), не флаг, который '
  'можно выставить в обход.';
comment on column public.tool_units.inventory_number is
  'Инвентарный номер, уникален по всей точке проката, а не по модели.';
comment on column public.tool_units.note is
  'Свободный комментарий менеджера: почему UNAVAILABLE, что не так.';


-- ---------------------------------------------------------------------
-- 1.1 Гранты и политики tool_units
-- ---------------------------------------------------------------------

revoke all on public.tool_units from anon;
grant select on public.tool_units to authenticated;
grant insert on public.tool_units to authenticated;
-- tool_id и id не входят в UPDATE-грант: модель единицы не меняют после
-- заведения (ошиблись моделью - списывают и заводят заново), created_at
-- ставит база. Разрешённые для правки колонки - именно то, что вправду
-- может понадобиться поправить руками: номер, статус, заметка.
grant update (inventory_number, status, note) on public.tool_units to authenticated;

-- service_role: сид-скрипт заводит тестовые единицы напрямую, минуя
-- интерфейс (тот появится только на этапе 7). BYPASSRLS обходит только
-- политики, грант всё равно нужен - тот же урок, что был с service_role
-- на staff на этапе 2 (grant_service_role_select_staff.sql), только
-- в этот раз добавлен сразу, а не после первого 42501 в сиде.
grant select, insert, update on public.tool_units to service_role;
-- Модели (tools) сид тоже заводит напрямую - в исходной миграции этапа 1
-- этого гранта не было, там сид ещё не работал с tools.
grant select, insert on public.tools to service_role;

alter table public.tool_units enable row level security;

-- SELECT, любой активный сотрудник.
-- Негатив: деактивированный сотрудник и anon - тот же принцип, что у
--   tools в главе 02.
create policy "staff can read tool units"
on public.tool_units for select
to authenticated
using ((select public.current_staff_role()) is not null);

-- INSERT, MANAGER и выше: заводить единицы - не дело оператора на стойке.
-- Негатив: OPERATOR, insert - 42501.
create policy "manager+ can insert tool units"
on public.tool_units for insert
to authenticated
with check ((select public.current_staff_role()) >= 'MANAGER');

-- UPDATE, MANAGER и выше.
-- USING и WITH CHECK совпадают - право не зависит от содержимого строки.
-- Сама допустимость перехода статуса - не про роль, её отдельно
-- ограничивает триггер tool_units_guard_status ниже: эта политика
-- разрешает "может тронуть строку", а не "может поставить любой статус".
-- Негатив: OPERATOR, update - 0 строк.
create policy "manager+ can update tool units"
on public.tool_units for update
to authenticated
using ((select public.current_staff_role()) >= 'MANAGER')
with check ((select public.current_staff_role()) >= 'MANAGER');

-- DELETE, только SUPERADMIN. on delete restrict у rental_items.tool_unit_id
-- не даст удалить единицу, которую хоть раз выдавали, - это тоже часть
-- защиты истории, не только грант.
-- Негатив: MANAGER, delete - 0 строк.
create policy "superadmin can delete tool units"
on public.tool_units for delete
to authenticated
using ((select public.current_staff_role()) = 'SUPERADMIN');


-- ---------------------------------------------------------------------
-- 1.2 Триггер: статус единицы следует из данных
-- ---------------------------------------------------------------------

-- Подробно: docs/book/04-rentals.md, раздел "Инвариант через данные,
-- а не через флаг".
-- Зачем: MANAGER имеет грант на запись status (иначе учёт нечем было бы
--   чинить руками), но не любой переход допустим. RENTED и выход из
--   RENTED должны совпадать с тем, есть ли у единицы активная позиция
--   в rental_items. Без этой проверки MANAGER мог бы поставить единице
--   RENTED без единой аренды - счётчик "выдано" на дашборде (этап 7)
--   разошёлся бы со списком реальных выдач.
-- Проверка идёт через exists в rental_items, а не через флаг сессии
--   вроде set_config('app.from_trigger', true, true): такой флаг живёт
--   в GUC текущего подключения, и любой authenticated клиент мог бы
--   выставить его себе перед прямым UPDATE tool_units из обычного
--   запроса, обойдя правило целиком. Данные подделать нечем - у
--   rental_items свои гранты, политики и триггеры (см. ниже).
-- security invoker: тело только читает rental_items, а у authenticated
--   и так есть на неё grant select с политикой "видно всё активным
--   сотрудникам" - поднимать права незачем.
-- search_path = '': полные имена объектов, подмена через объект-двойник
--   в другой схеме невозможна.
-- errcode P0001: бизнес-правило домена, не отказ политики.
create function public.tool_units_guard_status()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
as $$
declare
  v_has_active_position boolean;
begin
  if old.status = 'WRITTEN_OFF' then
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

comment on function public.tool_units_guard_status() is
  'Статус единицы должен совпадать с наличием активной позиции в '
  'rental_items. Источник истины - данные, а не флаг сессии.';

-- before: отказ до записи строки.
-- update of status: срабатывает, только если status есть в SET -
--   правка note или inventory_number его не поднимает.
-- Единственный before-триггер на tool_units для update of status:
--   порядок нескольких before-триггеров друг относительно друга (они
--   срабатывают в алфавитном порядке имён) здесь ни на что не влияет.
--   Правило важно там, где на одну таблицу и событие вешают больше
--   одного триггера - в этой миграции такого нет ни на одной таблице
--   ни для одной комбинации таблица/событие (разобрано в главе книги,
--   раздел "Порядок нескольких before-триггеров").
create trigger tool_units_guard_status
    before update of status on public.tool_units
    for each row
    execute function public.tool_units_guard_status();


-- ---------------------------------------------------------------------
-- 2. Аренда
-- ---------------------------------------------------------------------

-- CLOSED ставит только rental_items_sync_unit, когда возвращена
-- последняя активная позиция. Просрочка не хранится отдельным полем:
-- она - производная величина (status = 'ACTIVE' and planned_return_at
-- < now()), иначе пришлось бы держать её актуальной фоновой задачей.
create type public.rental_status as enum ('ACTIVE', 'CLOSED');

comment on type public.rental_status is
  'ACTIVE - хотя бы одна позиция не возвращена. CLOSED ставит только '
  'rental_items_sync_unit, приложение это поле не пишет.';

create table public.rentals (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers (id),
  -- default auth.uid(), а не отдельный триггер: колонка не грантована
  -- клиенту на запись (см. INSERT-грант ниже), подделать её нечем -
  -- обычного default достаточно, специальный триггер, как у customers
  -- на этапе 3, здесь не нужен.
  created_by         uuid not null default auth.uid() references public.staff (user_id),
  issued_at          timestamptz not null default now(),
  planned_return_at  timestamptz not null,
  status             public.rental_status not null default 'ACTIVE',
  closed_at          timestamptz,
  note               text,

  constraint rentals_planned_after_issued
    check (planned_return_at > issued_at),
  -- Согласованность статуса и времени закрытия: одно без другого -
  -- испорченная запись, которую без ограничения сложно даже найти.
  constraint rentals_closed_at_matches_status
    check ((status = 'CLOSED') = (closed_at is not null))
);

comment on table public.rentals is
  'Аренда: клиент, кто выдал, плановая дата возврата. Просрочка не '
  'хранится, вычисляется. Список единиц - в rental_items.';
comment on column public.rentals.created_by is
  'Сотрудник, оформивший аренду. Значение по умолчанию auth.uid() - '
  'колонка не грантована клиенту, поэтому не подделывается.';
comment on column public.rentals.status is
  'CLOSED ставит только rental_items_sync_unit, когда возвращена '
  'последняя активная позиция. Приложение это поле не пишет вообще.';


-- ---------------------------------------------------------------------
-- 2.1 Гранты и политики rentals
-- ---------------------------------------------------------------------

revoke all on public.rentals from anon;
grant select on public.rentals to authenticated;
-- Только содержательные поля: created_by, issued_at, status, closed_at
-- заполняет база или триггер rental_items_sync_unit, клиент их не пишет.
grant insert (customer_id, planned_return_at, note) on public.rentals to authenticated;
grant update (note) on public.rentals to authenticated;

alter table public.rentals enable row level security;

-- SELECT, любой активный сотрудник.
-- Негатив: anon - 42501 на гранте; залогиненный без staff - пусто.
create policy "staff can read rentals"
on public.rentals for select
to authenticated
using ((select public.current_staff_role()) is not null);

-- INSERT, любой активный сотрудник: выдаёт оператор на стойке, не
-- только менеджер.
-- Негатив: залогиненный без staff - 42501.
create policy "staff can create rentals"
on public.rentals for insert
to authenticated
with check ((select public.current_staff_role()) is not null);

-- UPDATE, любой активный сотрудник, но грантована только note (выше) -
-- эта политика не про то, какие колонки можно менять, это уже решил
-- грант, а про то, какие строки вообще можно трогать.
-- Негатив: залогиненный без staff - 0 строк.
create policy "staff can update rental note"
on public.rentals for update
to authenticated
using ((select public.current_staff_role()) is not null)
with check ((select public.current_staff_role()) is not null);

-- DELETE не выдан никому: история аренды не удаляется, как у customers
-- на этапе 3 - спорную аренду не стирают, а закрывают и комментируют.


-- ---------------------------------------------------------------------
-- 2.2 Триггер: NON_GRATA не получает аренду
-- ---------------------------------------------------------------------

-- security invoker: читает только customers, на которую у authenticated
--   уже есть select через политику "staff can read customers" (этап 3) -
--   поднимать права незачем.
-- volatile (по умолчанию): вызывается один раз на строку, кешировать
--   нечего.
-- errcode P0001: бизнес-правило домена, не отказ доступа - клиент
--   существует и виден, просто ему нельзя ещё одну аренду.
create function public.rentals_guard_customer()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
as $$
declare
  v_category public.customer_category;
begin
  select category into v_category
  from public.customers
  where id = new.customer_id;

  if v_category = 'NON_GRATA' then
    raise exception 'customer is in the NON_GRATA category and cannot rent tools'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public.rentals_guard_customer() is
  'Не пускает NON_GRATA клиентов на выдачу. Читает category обычным '
  'select под правами вызывающего - RLS на customers уже открыта для '
  'активного сотрудника, security definer не нужен.';

-- before insert: отказ до записи строки аренды - позиции ещё нет ни
-- одной, откатывать нечего кроме самой вставки.
create trigger rentals_guard_customer
    before insert on public.rentals
    for each row
    execute function public.rentals_guard_customer();


-- ---------------------------------------------------------------------
-- 3. Позиции аренды
-- ---------------------------------------------------------------------

create table public.rental_items (
  id                uuid primary key default gen_random_uuid(),
  rental_id         uuid not null references public.rentals (id) on delete restrict,
  tool_unit_id      uuid not null references public.tool_units (id) on delete restrict,
  issue_photo_path  text,
  returned_at       timestamptz,
  returned_by       uuid references public.staff (user_id),
  return_photo_path text,

  -- Возврат без фото невозможен: снимок состояния при возврате - то, на
  -- что ссылаются при споре с клиентом о сохранности инструмента.
  constraint rental_items_return_requires_photo
    check (returned_at is null or return_photo_path is not null),

  -- Путь ограничен своей аренда/позицией - тот же приём, что у customers
  -- на этапе 3 (customers_photo_path_own_folder), подробно там. В uuid
  -- нет символов % и _, поэтому like - точное сравнение префикса.
  constraint rental_items_issue_photo_own_folder
    check (
      issue_photo_path is null
      or issue_photo_path like rental_id::text || '/' || id::text || '/issue-%'
    ),
  constraint rental_items_return_photo_own_folder
    check (
      return_photo_path is null
      or return_photo_path like rental_id::text || '/' || id::text || '/return-%'
    )
);

-- Подробно: docs/book/04-rentals.md, раздел "Частичный индекс".
-- Одна единица не может быть одновременно в двух активных арендах:
-- индекс включает только строки с returned_at is null, поэтому историю
-- уже возвращённых позиций по той же единице он не ограничивает - у
-- одной единицы за время жизни таких строк много, активная - максимум
-- одна.
-- Без него: два оператора выдают одну единицу двум разным клиентам
-- одновременно, кладовщик физически отдаёт вещь дважды.
create unique index rental_items_active_unit
  on public.rental_items (tool_unit_id)
  where returned_at is null;

comment on table public.rental_items is
  'Одна физическая единица в одной аренде. Активная = returned_at is '
  'null, не больше одной активной на единицу (rental_items_active_unit).';
comment on column public.rental_items.issue_photo_path is
  'Путь в бакете rental-photos, не URL. Пишется отдельным UPDATE после '
  'вставки строки - файлу нужен id позиции, которого при INSERT ещё нет.';
comment on column public.rental_items.returned_by is
  'Кто принял возврат. Ставит триггер rental_items_set_return из '
  'auth.uid(), клиент это поле не пишет вообще - нет гранта.';


-- ---------------------------------------------------------------------
-- 3.1 Гранты и политики rental_items
-- ---------------------------------------------------------------------

revoke all on public.rental_items from anon;
grant select on public.rental_items to authenticated;
-- Только ссылки на аренду и единицу: пути к фото, время и кто принял
-- возврат клиент не пишет при вставке вообще - для этого отдельный
-- UPDATE-грант ниже и триггер rental_items_set_return.
grant insert (rental_id, tool_unit_id) on public.rental_items to authenticated;
grant update (issue_photo_path, returned_at, return_photo_path) on public.rental_items to authenticated;

alter table public.rental_items enable row level security;

-- SELECT, любой активный сотрудник.
-- Негатив: залогиненный без staff - пусто; anon - 42501 на гранте.
create policy "staff can read rental items"
on public.rental_items for select
to authenticated
using ((select public.current_staff_role()) is not null);

-- INSERT, любой активный сотрудник, но только в открытую аренду.
-- WITH CHECK: роль плюс exists в rentals - аренда должна существовать
--   и быть ACTIVE. Подзапрос идёт от имени того же вызывающего, RLS
--   rentals уже открыта активному сотруднику (раздел 2.1) - повторно
--   её не расширяет и не сужает.
--   Выбор политики, а не триггера, для этого правила и почему -
--   docs/book/04-rentals.md, раздел "Решения и альтернативы".
-- Негатив: вставка с rental_id уже CLOSED аренды - 42501; залогиненный
--   без staff - 42501.
create policy "staff can add items to active rentals"
on public.rental_items for insert
to authenticated
with check (
  (select public.current_staff_role()) is not null
  and exists (
    select 1 from public.rentals r
    where r.id = rental_id and r.status = 'ACTIVE'
  )
);

-- UPDATE, любой активный сотрудник: записать issue_photo_path после
-- загрузки фото, оформить возврат.
-- Какой именно переход допустим (нельзя вернуть в null, нельзя менять
-- повторно) держит триггер rental_items_set_return, не эта политика -
-- она про роль и видимость строки, а не про конкретные значения.
-- Негатив: залогиненный без staff - 0 строк.
create policy "staff can update rental items"
on public.rental_items for update
to authenticated
using ((select public.current_staff_role()) is not null)
with check ((select public.current_staff_role()) is not null);

-- DELETE не выдан никому: история выдачи и возврата не удаляется.


-- ---------------------------------------------------------------------
-- 3.2 Триггер: время и автора возврата ставит база
-- ---------------------------------------------------------------------

-- Подробно: docs/book/04-rentals.md, раздел "Время ставит триггер".
-- Зачем: returned_at грантован клиенту на запись (нужно самому отметить
--   момент приёмки), но именно поэтому доверять присланному значению
--   нельзя - иначе оператор мог бы прислать returned_at в прошлом и
--   убрать просрочку клиенту, которого выручает.
-- security invoker: не трогает ничего за пределами своей же строки,
--   права сверх прав вызывающего не нужны.
-- errcode P0001: домен, не отказ гранта или политики.
create function public.rental_items_set_return()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
as $$
begin
  if old.returned_at is not null then
    raise exception 'return is already recorded and cannot be changed'
      using errcode = 'P0001';
  end if;

  if new.returned_at is null then
    raise exception 'return date cannot be cleared'
      using errcode = 'P0001';
  end if;

  new.returned_at := now();
  new.returned_by := auth.uid();

  return new;
end;
$$;

comment on function public.rental_items_set_return() is
  'Время и автора возврата ставит база: то, что прислал клиент в '
  'returned_at, отбрасывается и заменяется на now()/auth.uid().';

-- before: успевает подменить значения до записи строки.
-- update of returned_at: срабатывает, только если это поле в SET -
--   правка issue_photo_path его не поднимает.
create trigger rental_items_set_return
    before update of returned_at on public.rental_items
    for each row
    execute function public.rental_items_set_return();


-- ---------------------------------------------------------------------
-- 3.3 Триггер: статус единицы и аренды следует из rental_items
-- ---------------------------------------------------------------------

-- Подробно: docs/book/04-rentals.md, раздел "security definer в
-- триггерной функции, которая пишет в чужие таблицы".
-- Зачем security definer: сама функция выполняется от имени того, кто
--   сделал INSERT/UPDATE в rental_items (обычно OPERATOR), а ей нужно
--   поменять tool_units.status (UPDATE-грант на эту колонку есть только
--   у MANAGER+) и rentals.status/closed_at (эти колонки вообще не
--   грантованы клиенту на запись). Без security definer у оператора не
--   хватило бы прав дописать обе таблицы, и выдача падала бы с 42501
--   сразу после успешной вставки в rental_items.
-- Эти права не утекают наружу: функция не принимает ничего от клиента
--   напрямую и не отдаёт ему ничего лишнего - только читает и пишет по
--   id из той же строки rental_items, которую сработавший триггер уже
--   видит, и по rental_id/tool_unit_id из неё же.
-- volatile (по умолчанию): вызывается один раз на строку, не кешируется.
-- search_path = '': полные имена объектов.
-- Исключение внутри не гасится security definer: raise всё равно
--   откатывает транзакцию целиком, ошибка доходит до клиента как обычно.
create function public.rental_items_sync_unit()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
  v_unit_status public.tool_unit_status;
  v_all_returned boolean;
begin
  if tg_op = 'INSERT' then
    select status into v_unit_status
    from public.tool_units
    where id = new.tool_unit_id;

    if v_unit_status <> 'AVAILABLE' then
      raise exception 'unit is not available for issue'
        using errcode = 'P0001';
    end if;

    update public.tool_units
    set status = 'RENTED'
    where id = new.tool_unit_id;

    return new;
  end if;

  -- tg_op = 'UPDATE': срабатывает, только когда returned_at перешло из
  -- null в значение - rental_items_set_return не пускает других
  -- переходов (см. выше), поэтому здесь дополнительная проверка не нужна.
  update public.tool_units
  set status = 'AVAILABLE'
  where id = new.tool_unit_id;

  select not exists (
    select 1 from public.rental_items ri
    where ri.rental_id = new.rental_id and ri.returned_at is null
  ) into v_all_returned;

  if v_all_returned then
    update public.rentals
    set status = 'CLOSED', closed_at = now()
    where id = new.rental_id;
  end if;

  return new;
end;
$$;

comment on function public.rental_items_sync_unit() is
  'Статус tool_units и закрытие rentals - производная от rental_items, '
  'не то, что приложение пишет напрямую. security definer - см. '
  'комментарий выше над определением функции.';

-- after: строка уже записана, есть что читать через exists.
-- insert or update of returned_at: одна функция на оба события, вход
--   различают через tg_op - так инвариант "статус следует из данных"
--   держится в одном месте, а не в двух похожих триггерах.
-- Единственный after-триггер на rental_items: возможные before-триггеры
--   этой же таблицы (rental_items_set_return) идут раньше по фазе
--   (before всегда раньше after), а не по алфавиту - алфавитный порядок
--   действует только между триггерами одной фазы на одном событии,
--   которых здесь по одному на каждую комбинацию.
create trigger rental_items_sync_unit
    after insert or update of returned_at on public.rental_items
    for each row
    execute function public.rental_items_sync_unit();
