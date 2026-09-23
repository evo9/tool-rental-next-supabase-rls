-- =====================================================================
-- Этап 5. Тариф и просрочка
--
-- Что делает:
--   1. Таблица category_grace_periods - grace period по категории клиента.
--   2. Снимки цены: rentals.grace_hours, rental_items.daily_rate -
--      заполняются триггерами в момент создания строки, backfill для уже
--      существующих строк, потом NOT NULL.
--   3. rental_items.amount - итог позиции, заполняется при возврате.
--   4. public.calc_rental_amount() - единственное место с тарифной
--      логикой, чистая immutable-функция без обращения к таблицам.
--   5. Триггер, который считает amount при возврате - обязан сработать
--      после того, как rental_items_set_return (этап 4) заменит
--      присланное клиентом returned_at на now().
--   6. public.rental_estimate() - сумма по позиции на произвольный
--      момент времени, для незакрытых - на лету, для закрытых -
--      сохранённая.
--
-- Зависит от:
--   20260918094510_staff_and_roles.sql - public.staff_role,
--                                         current_staff_role()
--   20260921200621_customers_and_storage.sql - public.customers,
--                                               public.customer_category
--   20260923120539_tool_units_and_rentals.sql - public.rentals,
--     public.rental_items, public.tool_units, триггер
--     rental_items_set_return (порядок относительно него важен ниже)
--
-- Новое в этой миграции (подробно в docs/book/05-pricing.md):
--   immutable/stable/volatile у функций; чистая функция расчёта отдельно
--   от функции, читающей данные; security invoker у RPC, читающего чужие
--   строки под RLS вызывающего; снимок значений в момент выдачи и почему
--   нельзя считать по текущим; арифметика timestamptz/interval через
--   extract(epoch from ...) и ceil; округление денег.
--
-- Как проверить:
--   psql "$DB_URL" -f tests/pricing/05_calc.sql
--   psql "$DB_URL" -f tests/policies/05_pricing.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Grace period по категории клиента
-- ---------------------------------------------------------------------

-- category - и PK, и единственная содержательная связь с enum: строка на
-- каждое значение customer_category, не больше и не меньше. INSERT и
-- DELETE не грантованы никому - набор строк равен набору значений enum,
-- добавить или убрать категорию можно только миграцией (ALTER TYPE),
-- отдельная строка без соответствующего значения enum невозможна и не
-- нужна.
create table public.category_grace_periods (
  category    public.customer_category primary key,
  grace_hours int not null check (grace_hours between 0 and 72)
);

comment on table public.category_grace_periods is
  'Grace period просрочки по категории клиента, в часах. Строка на '
  'каждое значение customer_category. INSERT/DELETE не грантованы - '
  'набор строк совпадает с набором значений enum.';
comment on column public.category_grace_periods.grace_hours is
  'Часов после planned_return_at, в течение которых просрочка не '
  'начисляется. Значение снимается в rentals.grace_hours при выдаче - '
  'смотри комментарий там же.';

insert into public.category_grace_periods (category, grace_hours) values
  ('PLATINUM', 24),
  ('GOLD', 12),
  ('SILVER', 3),
  ('NON_GRATA', 0);

revoke all on public.category_grace_periods from anon;
grant select on public.category_grace_periods to authenticated;
-- Только grace_hours: category - PK, значение по умолчанию совпадает со
-- значением enum и переписывать его не за чем (переименование категории
-- значило бы миграцию enum, не UPDATE строки).
grant update (grace_hours) on public.category_grace_periods to authenticated;

alter table public.category_grace_periods enable row level security;

-- SELECT, любой активный сотрудник - grace нужен интерфейсу карточки
-- клиента и аренды всем ролям, не только MANAGER+.
-- Негатив: деактивированный сотрудник и anon - тот же принцип, что у
--   tools в главе 02.
create policy "staff can read grace periods"
on public.category_grace_periods for select
to authenticated
using ((select public.current_staff_role()) is not null);

-- UPDATE, MANAGER и выше. Тот же приём, что у tools.daily_rate в главе
-- 02: грант на таблицу выдан всем authenticated, а роль решает политика -
-- значит у OPERATOR результат "0 строк", а не 42501 (грант есть, не
-- прошла политика). Так эта таблица ведёт себя как tools/tool_units, а
-- не как rentals.grace_hours ниже, который не грантован вообще никому -
-- разница в том, что здесь MANAGER должен иметь возможность значение
-- поменять, а снимок в rentals - вообще ничья прямая запись.
-- Негатив: OPERATOR, update - 0 строк.
create policy "manager+ can update grace periods"
on public.category_grace_periods for update
to authenticated
using ((select public.current_staff_role()) >= 'MANAGER')
with check ((select public.current_staff_role()) >= 'MANAGER');


-- ---------------------------------------------------------------------
-- 2. Снимки: rentals.grace_hours, rental_items.daily_rate
-- ---------------------------------------------------------------------

-- Подробно: docs/book/05-pricing.md, раздел "Снимок значений в момент
-- выдачи".
-- Зачем снимок, а не пересчёт по текущим tools.daily_rate/
-- category_grace_periods.grace_hours: тариф модели и grace категории
-- меняются со временем (менеджер поднял цену, пересмотрел grace), а
-- сумма уже выданной или уже закрытой аренды не должна задним числом
-- поплыть от решения, принятого после того, как клиент забрал
-- инструмент. Колонки добавляются NULL, чтобы можно было сначала
-- заполнить их для уже существующих строк (backfill), и только потом
-- поставить NOT NULL - если бы NOT NULL стоял сразу, ALTER TABLE упал бы
-- на первой же существующей строке.
alter table public.rentals
  add column grace_hours int;
alter table public.rental_items
  add column daily_rate numeric(10, 2);
-- amount остаётся nullable навсегда, не только на время backfill: у
-- открытой позиции суммы ещё не существует, это не "значение пока не
-- заполнили", а "значения по смыслу ещё нет" (закрепляется ограничением
-- ниже, в разделе 3).
alter table public.rental_items
  add column amount numeric(10, 2);

-- Backfill: снимок для строк, заведённых до этой миграции. Условие
-- "grace_hours is null" делает запрос идемпотентным - повторный прогон
-- (например, после repair) не трогает уже заполненные строки.
update public.rentals r
set grace_hours = cgp.grace_hours
from public.customers c
join public.category_grace_periods cgp on cgp.category = c.category
where c.id = r.customer_id
  and r.grace_hours is null;

update public.rental_items ri
set daily_rate = t.daily_rate
from public.tool_units tu
join public.tools t on t.id = tu.tool_id
where tu.id = ri.tool_unit_id
  and ri.daily_rate is null;

-- NOT NULL только теперь, когда во всех существующих строках уже есть
-- значение. До триггеров ниже: они наполняют снимок для новых строк,
-- backfill выше - для тех, что появились раньше триггеров.
alter table public.rentals
  alter column grace_hours set not null;
alter table public.rental_items
  alter column daily_rate set not null;

comment on column public.rentals.grace_hours is
  'Снимок category_grace_periods.grace_hours на момент создания аренды. '
  'Ставит триггер rentals_set_grace_hours, колонка не грантована на '
  'запись клиенту - последующая смена grace категории эту аренду не '
  'затрагивает.';
comment on column public.rental_items.daily_rate is
  'Снимок tools.daily_rate (через tool_units.tool_id) на момент '
  'создания позиции. Ставит триггер rental_items_set_daily_rate, '
  'колонка не грантована на запись - последующая смена тарифа модели '
  'эту позицию не затрагивает.';
comment on column public.rental_items.amount is
  'Итог позиции, считает calc_rental_amount(). NULL, пока позиция не '
  'возвращена (см. ограничение rental_items_amount_matches_return), '
  'дальше не пересчитывается.';


-- ---------------------------------------------------------------------
-- 2.1 Триггеры: наполнение снимков при создании строки
-- ---------------------------------------------------------------------

-- security invoker: читает customers и category_grace_periods, на
-- которые у authenticated уже есть select через политики "staff can read
-- customers" (этап 3) и "staff can read grace periods" (раздел 1 выше) -
-- поднимать права незачем, тот же выбор, что у rentals_guard_customer.
-- volatile (по умолчанию): один раз на строку, кешировать нечего.
create function public.rentals_set_grace_hours()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
as $$
begin
  select cgp.grace_hours into new.grace_hours
  from public.customers c
  join public.category_grace_periods cgp on cgp.category = c.category
  where c.id = new.customer_id;

  return new;
end;
$$;

comment on function public.rentals_set_grace_hours() is
  'Снимок grace_hours категории клиента в момент создания аренды. '
  'Отдельный триггер, не часть rentals_guard_customer - см. комментарий '
  'над create trigger ниже про порядок с этим триггером.';

-- before insert, второй триггер на rentals для этого события -
-- rentals_guard_customer (этап 4) уже before insert на этой же таблице.
-- Порядок между ними (алфавитный: rentals_guard_customer раньше
-- rentals_set_grace_hours) не влияет на результат: rentals_guard_customer
-- не пишет в NEW и только решает, продолжать вставку или прервать её
-- исключением, а rentals_set_grace_hours не смотрит на исход этой
-- проверки. Если бы guard отклонил клиента (NON_GRATA), вся вставка
-- откатится целиком независимо от того, что успел или не успел
-- записать в NEW снимок - какой из двух триггеров сработал первым, не
-- имеет значения. Не объединены в один триггер (в отличие от трёх
-- правил tool_units_guard_status в этапе 4), чтобы не смешивать
-- "разрешить или отклонить клиента" с "заполнить служебное поле" в одной
-- функции с двумя разными обязанностями.
create trigger rentals_set_grace_hours
    before insert on public.rentals
    for each row
    execute function public.rentals_set_grace_hours();

-- security invoker: читает tool_units и tools, на которые у
-- authenticated уже есть select (этапы 1, 4) - поднимать права незачем.
create function public.rental_items_set_daily_rate()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
as $$
begin
  select t.daily_rate into new.daily_rate
  from public.tool_units tu
  join public.tools t on t.id = tu.tool_id
  where tu.id = new.tool_unit_id;

  return new;
end;
$$;

comment on function public.rental_items_set_daily_rate() is
  'Снимок daily_rate модели (через tool_unit_id) в момент создания '
  'позиции аренды.';

-- before insert - единственный before-триггер на rental_items для
-- insert, вопрос порядка здесь не встаёт.
create trigger rental_items_set_daily_rate
    before insert on public.rental_items
    for each row
    execute function public.rental_items_set_daily_rate();


-- ---------------------------------------------------------------------
-- 3. Чистая функция расчёта
-- ---------------------------------------------------------------------

-- Подробно: docs/book/05-pricing.md, разделы "immutable/stable/volatile"
-- и "Арифметика timestamptz и interval".
-- Единственное место, где живёт тарифная логика проекта. У заказчика
-- свои документы RENT-001...RENT-004, где формула может отличаться -
-- замена сводится к create or replace этой одной функции, ничего вокруг
-- (триггеры, rental_estimate, интерфейс) трогать не придётся.
-- language sql, а не plpgsql: тело - одно выражение без ветвлений и
-- переменных, читается как формула.
-- immutable: результат зависит только от аргументов, никакого обращения
-- к таблицам или now() внутри. Раз пообещали - a значит компилятор
-- планов вправе не пересчитывать функцию повторно для одних и тех же
-- аргументов в пределах запроса и вправе использовать результат в
-- индексных выражениях. Если бы тело читало таблицу (например, тариф
-- по id модели вместо параметра), immutable была бы ложью: планировщик
-- мог бы закешировать устаревший результат, и после смены тарифа старые
-- расчёты продолжали бы отдавать старое значение до перезапуска сессии
-- или инвалидации плана - в лучшем случае непредсказуемо, в худшем тихо.
-- extract(epoch from <interval>) переводит interval в число секунд
-- (numeric) - делить интервал на интервал (24 часа) Postgres не умеет
-- напрямую для получения дробного количества суток, а секунды - обычные
-- числа, с ними работает обычное деление и ceil.
-- numeric(10,2) на выходе и round(..., 2): деньги - не float, ошибка
-- округления float на суммах в гривнах недопустима; round у numeric
-- точный, банковское round half to even Postgres не использует - но на
-- вход сюда попадает уже integer * numeric(10,2), дробная часть не
-- длиннее двух знаков, округлять по сути нечего, round - подстраховка
-- формы, а не защита от неточности.
create function public.calc_rental_amount(
    p_rate numeric,
    p_issued timestamptz,
    p_planned timestamptz,
    p_returned timestamptz,
    p_grace_hours int
)
    returns table (base_days int, overdue_days int, amount numeric)
    language sql
    immutable
    set search_path = ''
as $$
  select
    d.base_days,
    d.overdue_days,
    round((d.base_days + d.overdue_days) * p_rate, 2) as amount
  from (
    select
      greatest(
        1,
        ceil(extract(epoch from (least(p_returned, p_planned) - p_issued)) / 86400.0)
      )::int as base_days,
      greatest(
        0,
        ceil(
          extract(epoch from greatest(
            p_returned - p_planned - make_interval(hours => p_grace_hours),
            interval '0'
          )) / 86400.0
        )
      )::int as overdue_days
  ) d
$$;

comment on function public.calc_rental_amount(numeric, timestamptz, timestamptz, timestamptz, int) is
  'Чистая формула тарифа: сутки по факту (минимум одни) плюс начатые '
  'сутки просрочки сверх grace. Единственное место с тарифной логикой - '
  'см. комментарий над определением. immutable: только арифметика над '
  'аргументами, ни одной таблицы внутри.';

-- Supabase по умолчанию выдаёт execute на новую функцию роли public.
revoke execute on function public.calc_rental_amount(numeric, timestamptz, timestamptz, timestamptz, int)
  from public, anon;
grant execute on function public.calc_rental_amount(numeric, timestamptz, timestamptz, timestamptz, int)
  to authenticated;

-- Backfill amount для уже возвращённых до этой миграции позиций - тем же
-- вызовом calc_rental_amount, которым будет пользоваться триггер ниже.
-- "amount is null" делает запрос идемпотентным при повторном прогоне.
-- LATERAL не может ссылаться на цель UPDATE (ri) напрямую - она не
-- является элементом списка FROM этого запроса, а только неявно
-- присоединена через SET/WHERE. Поэтому расчёт вынесен в подзапрос со
-- своим, независимым от цели, экземпляром rental_items (ri2), а строка
-- цели находится обратно по id.
update public.rental_items ri
set amount = calc.amount
from (
  select ri2.id, c.amount
  from public.rental_items ri2
  join public.rentals r on r.id = ri2.rental_id
  cross join lateral public.calc_rental_amount(
    ri2.daily_rate, r.issued_at, r.planned_return_at, ri2.returned_at, r.grace_hours
  ) as c
  where ri2.returned_at is not null
    and ri2.amount is null
) as calc
where ri.id = calc.id;

-- Держит согласованность "возвращена <=> есть сумма" после backfill
-- и для всех новых строк: amount заполняет только триггер ниже, ровно
-- в тот момент, когда returned_at перестаёт быть null.
alter table public.rental_items
  add constraint rental_items_amount_matches_return
  check ((returned_at is null) = (amount is null));


-- ---------------------------------------------------------------------
-- 4. Расчёт при возврате
-- ---------------------------------------------------------------------

-- Подробно: docs/book/05-pricing.md, раздел "Почему это два триггера, а
-- не один".
-- Зачем отдельный триггер, а не расширение rental_items_set_return
-- (этап 4): та функция принимает время и автора возврата, эта - считает
-- деньги по уже принятому времени. Разные обязанности, а объединение
-- потребовало бы трогать applied-миграцию этапа 4 без веской причины
-- (CLAUDE.md: исправление - новой миграцией, а не правкой отправленной,
-- кроме идемпотентных находок по факту ошибки - это не тот случай).
-- Порядок между этим триггером и rental_items_set_return критичен и
-- решён именно именем: оба - before update of returned_at на одной
-- таблице, Postgres выполняет такие триггеры в алфавитном порядке имён.
-- "rental_items_set_return" - точный префикс
-- "rental_items_set_return_amount", а более короткая строка-префикс
-- всегда сортируется раньше более длинной с тем же началом - значит
-- rental_items_set_return гарантированно первым, ещё до этого триггера,
-- заменит присланный клиентом returned_at на now(). Если бы этот триггер
-- сработал первым, new.returned_at всё ещё содержал бы значение клиента
-- (в том числе задним числом), и amount считался бы по подделанному
-- времени - ровно то, от чего защищает rental_items_set_return.
-- Альтернатива "объединить в один триггер" не выбрана: пришлось бы
-- редактировать функцию этапа 4 (см. выше про applied-миграции), а имя,
-- которое само гарантирует нужный порядок, читается как документация
-- этого порядка без отдельного флага или комментария на месте вызова.
-- security invoker: читает rentals, на которую у authenticated уже есть
-- select (этап 4) - поднимать права незачем.
create function public.rental_items_set_return_amount()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
as $$
declare
  v_issued  timestamptz;
  v_planned timestamptz;
  v_grace   int;
  v_calc    record;
begin
  select r.issued_at, r.planned_return_at, r.grace_hours
    into v_issued, v_planned, v_grace
  from public.rentals r
  where r.id = new.rental_id;

  select * into v_calc
  from public.calc_rental_amount(new.daily_rate, v_issued, v_planned, new.returned_at, v_grace);

  new.amount := v_calc.amount;

  return new;
end;
$$;

comment on function public.rental_items_set_return_amount() is
  'Считает amount при возврате по снимкам daily_rate/grace_hours и уже '
  'исправленному (rental_items_set_return) returned_at. Порядок с этим '
  'триггером держит имя - см. комментарий над create trigger ниже.';

create trigger rental_items_set_return_amount
    before update of returned_at on public.rental_items
    for each row
    execute function public.rental_items_set_return_amount();


-- ---------------------------------------------------------------------
-- 5. Оценка суммы по позиции: открытые и закрытые
-- ---------------------------------------------------------------------

-- Подробно: docs/book/05-pricing.md, раздел "security invoker у RPC:
-- RLS работает внутри функции".
-- Зачем отдельная функция, а не просто SELECT из приложения: у открытой
-- позиции суммы ещё нет в таблице (amount is null, начисляется только
-- при возврате), а "сколько набежало прямо сейчас" нужно показать в
-- карточке аренды. rental_estimate вызывает calc_rental_amount с
-- p_returned = p_at для открытых позиций - используется та же формула,
-- что и настоящий расчёт при возврате, без второй копии логики.
-- Для уже закрытых позиций базовый и просроченный дни всё равно
-- пересчитываются через calc_rental_amount с p_returned = фактический
-- returned_at (только для отображения расшифровки), а итоговая сумма
-- берётся из сохранённого rental_items.amount (coalesce), а не из
-- пересчёта: если calc_rental_amount когда-нибудь заменят другой
-- формулой (раздел 3 - ради этого функция и выделена отдельно), уже
-- закрытые аренды не должны задним числом поменять сумму, которую
-- видел клиент при возврате.
-- stable: без записи, для фиксированных аргументов результат неизменен
-- в пределах запроса - но не immutable, потому что p_at обычно now(),
-- а сама функция читает таблицы (rentals, rental_items), не только
-- аргументы.
-- security invoker: сама RLS делает всю работу по правам - вызывающий
-- без активной строки в staff получает пустой результат (политики
-- "staff can read rentals"/"staff can read rental items" не пропускают
-- ни одной строки), а не отдельная проверка внутри функции. Показать
-- тестом: tests/policies/05_pricing.sql, "rental_estimate от
-- пользователя без staff - пусто".
create function public.rental_estimate(
    p_rental_id uuid,
    p_at timestamptz default now()
)
    returns table (
        rental_item_id uuid,
        base_days      int,
        overdue_days   int,
        amount         numeric,
        is_returned    boolean
    )
    language plpgsql
    stable
    security invoker
    set search_path = ''
as $$
begin
  return query
  select
    ri.id,
    calc.base_days,
    calc.overdue_days,
    coalesce(ri.amount, calc.amount),
    ri.returned_at is not null
  from public.rental_items ri
  join public.rentals r on r.id = ri.rental_id
  cross join lateral public.calc_rental_amount(
    ri.daily_rate,
    r.issued_at,
    r.planned_return_at,
    coalesce(ri.returned_at, p_at),
    r.grace_hours
  ) as calc
  where ri.rental_id = p_rental_id;
end;
$$;

comment on function public.rental_estimate(uuid, timestamptz) is
  'Сумма по каждой позиции аренды на момент p_at: для открытых - на '
  'лету, для закрытых - сохранённая (не пересчитывается заново). '
  'security invoker - пустой результат для не-сотрудника доказывает, '
  'что внутри работает RLS вызывающего, а не отдельная проверка роли.';

revoke execute on function public.rental_estimate(uuid, timestamptz) from public, anon;
grant execute on function public.rental_estimate(uuid, timestamptz) to authenticated;
