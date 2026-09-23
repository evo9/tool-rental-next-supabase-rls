-- =====================================================================
-- Этап 7. Дашборд, единицы, импорт CSV
--
-- Что делает:
--   1. Уникальный индекс на нормализованное имя модели tools: без него
--      импорт по имени не может однозначно найти или создать модель.
--   2. Заменяет политику INSERT на tool_units: новую единицу можно завести
--      только в статусе AVAILABLE или UNAVAILABLE.
--   3. View public.dashboard_counts (security_invoker) - счётчики для
--      дашборда, которые сами подчиняются RLS вызывающего.
--   4. RPC public.import_tool_units(jsonb) - построчный импорт единиц,
--      где ошибка одной строки не отменяет остальные.
--
-- Зависит от:
--   20260917211501_create_tools.sql, 20260918094510_staff_and_roles.sql -
--     public.tools (колонки name, daily_rate, deposit_value),
--     политика "tools: manager+ inserts", current_staff_role()
--   20260923120539_tool_units_and_rentals.sql - public.tool_units,
--     public.rentals, политика "manager+ can insert tool units"
--
-- Новое в этой миграции (подробно в docs/book/07-dashboard-import-qr.md):
--   view с security_invoker = true и ловушка view без него; блок
--   begin ... exception ... end в plpgsql как подтранзакция (savepoint);
--   уникальный индекс по выражению lower(btrim(name)).
--
-- Как проверить:
--   psql "$DB_URL" -f tests/policies/07_dashboard_import.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Уникальное имя модели после нормализации
-- ---------------------------------------------------------------------

-- Подробно: docs/book/07-dashboard-import-qr.md, раздел "Уникальный
-- индекс по выражению".
-- Импорт ищет модель по названию из файла. Пока названия не уникальны,
-- "найти по имени" может вернуть две строки, а "создать, если нет" -
-- завести вторую модель с тем же названием при каждом повторном импорте.
-- Индекс строится не по name, а по lower(btrim(name)): в файле, который
-- люди набирают руками и сохраняют из Excel, "Перфоратор", "перфоратор "
-- (пробел в конце) и "ПЕРФОРАТОР" - одна и та же модель. Индекс по голому
-- name счёл бы их тремя разными и пропустил.
-- Условие поиска в import_tool_units обязано повторять это же выражение
-- слово в слово: с другим выражением индекс не используется, а
-- on conflict (...) не находит, по какому индексу разрешать конфликт.
-- lower() зависит от локали базы (ctype): здесь en_US.UTF-8, и кириллица
-- приводится к нижнему регистру. В базе с ctype C "Дрель" и "дрель"
-- остались бы разными.
-- Нарушитель получает 23505, имя ограничения - tools_name_normalized_key.
-- Если в облачной базе уже есть модели-дубли, create упадёт с 23505 на
-- самом создании индекса - дубли нужно объединить руками до миграции
-- (на момент написания дублей нет).
create unique index tools_name_normalized_key
  on public.tools (lower(btrim(name)));

comment on index public.tools_name_normalized_key is
  'Название модели уникально без учёта регистра и крайних пробелов. '
  'Импорт CSV ищет и создаёт модели по этому же выражению.';


-- ---------------------------------------------------------------------
-- 2. Политика INSERT на tool_units: только допустимые стартовые статусы
-- ---------------------------------------------------------------------

-- Зачем менять: tool_units_guard_status (этап 4) - триггер "before update
-- of status", то есть он ловит только смену статуса у существующей
-- строки. На INSERT он не срабатывает, а грант insert на tool_units
-- выдан на всю таблицу. Значит MANAGER мог вставить единицу сразу
-- в статусе RENTED (без единой аренды) или WRITTEN_OFF, и инвариант
-- "RENTED = есть активная позиция в rental_items" ломался бы в обход
-- триггера. Счётчик "rented" на дашборде разошёлся бы с числом реальных
-- аренд.
-- Почему политика, а не триггер: WITH CHECK видит новую строку целиком,
-- а условие про одну колонку новой строки - ровно то, для чего он
-- нужен. Тот же выбор, что у "staff can add items to active rentals" на
-- этапе 4: у INSERT нет OLD, отдельная триггерная функция не нужна.
-- Replace идемпотентен: drop policy if exists + create policy.
-- Роль и операция: MANAGER и выше, INSERT.
-- WITH CHECK:
--   current_staff_role() >= 'MANAGER' - как и было, оператору заводить
--     единицы не положено.
--   status in ('AVAILABLE', 'UNAVAILABLE') - единица появляется свободной
--     или временно недоступной. RENTED ей ставит только выдача
--     (rental_items_sync_unit), WRITTEN_OFF - только списание уже
--     существующей единицы.
-- Что не затронуто: seed-скрипт заводит единицы под service_role, у
--   которого BYPASSRLS, политика к нему не применяется (единица
--   WRITTEN_OFF в сиде остаётся возможной).
-- Негатив: MANAGER, insert со status 'RENTED' или 'WRITTEN_OFF' - 42501;
--   OPERATOR, insert с любым статусом - 42501.
drop policy if exists "manager+ can insert tool units" on public.tool_units;

create policy "manager+ can insert tool units"
on public.tool_units for insert
to authenticated
with check (
  (select public.current_staff_role()) >= 'MANAGER'
  and status in ('AVAILABLE', 'UNAVAILABLE')
);


-- ---------------------------------------------------------------------
-- 3. Дашборд: view со счётчиками
-- ---------------------------------------------------------------------

-- Подробно: docs/book/07-dashboard-import-qr.md, раздел "security_invoker
-- у view".
-- Ловушка, ради которой этот view вообще требует объяснения: view в
-- Postgres по умолчанию выполняет свой запрос с правами ВЛАДЕЛЬЦА view
-- (postgres), а не того, кто его читает. Владелец таблиц не подчиняется
-- RLS (нет FORCE ROW LEVEL SECURITY, тот же факт, что лежит в основе
-- current_staff_role()). Значит обычный view поверх tool_units и rentals
-- показал бы реальные счётчики любому, у кого есть select на сам view,
-- в том числе залогиненному пользователю без строки в staff, - политики
-- базовых таблиц не сработали бы вообще. Тест 07 показывает это на
-- копии view без опции.
-- with (security_invoker = true) (Postgres 15+) переключает view на права
-- и RLS вызывающего: запрос внутри выполняется так, как если бы
-- вызывающий написал его сам. Политики "staff can read tool units" и
-- "staff can read rentals" отфильтруют строки, а грант select на
-- базовые таблицы у authenticated уже есть.
-- Результат для ролей:
--   активный сотрудник (любая роль) - реальные числа;
--   залогиненный без staff или деактивированный - одна строка из нулей:
--     агрегат count(*) по нулю видимых строк возвращает 0, а не пустой
--     результат, потому что агрегат без group by всегда даёт ровно одну
--     строку;
--   anon - 42501, у него нет гранта на view (первый слой, до RLS).
-- Одна строка, шесть колонок, а не строка на статус: дашборд читает все
-- счётчики одним запросом. Колонки bigint (тип count), supabase gen
-- types отдаёт их как number.
-- Просрочка: status = 'ACTIVE' и planned_return_at < now(). То же
-- правило, что в isOverdue() интерфейса и в комментарии к rental_status
-- (этап 4): просрочку не хранят, вычисляют. Grace period сюда не входит:
-- он решает, когда начнёт начисляться доплата (этап 5), а не то, что
-- инструмент уже должен был вернуться. now() вычисляется при каждом
-- чтении view, фоновой задачи не нужно.
create view public.dashboard_counts
with (security_invoker = true)
as
select
  (select count(*) from public.tool_units where status = 'AVAILABLE')
    as available,
  (select count(*) from public.tool_units where status = 'RENTED')
    as rented,
  (select count(*) from public.tool_units where status = 'UNAVAILABLE')
    as unavailable,
  (select count(*) from public.tool_units where status = 'WRITTEN_OFF')
    as written_off,
  (select count(*) from public.rentals where status = 'ACTIVE')
    as active_rentals,
  (select count(*) from public.rentals
    where status = 'ACTIVE' and planned_return_at < now())
    as overdue_rentals;

comment on view public.dashboard_counts is
  'Счётчики дашборда одной строкой. security_invoker = true: view '
  'выполняется с правами и RLS вызывающего, поэтому не-сотрудник видит '
  'нули. Без этой опции view обошёл бы RLS базовых таблиц.';

-- Автоматических грантов на новые объекты нет (CLAUDE.md, "Особенности
-- окружения"): без явного grant view читать не может никто, кроме
-- владельца. anon отзываем явно, чтобы не зависеть от default privileges.
-- Писать во view нельзя никому: гранта insert/update/delete нет, а сам
-- view из подзапросов-агрегатов не обновляемый.
revoke all on public.dashboard_counts from anon;
grant select on public.dashboard_counts to authenticated;


-- ---------------------------------------------------------------------
-- 4. RPC: импорт единиц из CSV
-- ---------------------------------------------------------------------

-- Подробно: docs/book/07-dashboard-import-qr.md, раздел "Подтранзакции
-- в plpgsql".
-- Кто вызывает: route handler POST /api/import/tool-units после разбора
--   файла и проверки формата (papaparse, zod). Формат проверяется до базы
--   и получает номер строки в отчёте; сюда приходят только строки, у
--   которых формат уже правильный. Но функция не полагается на это:
--   приведение типов и ограничения таблиц ловят то же самое ещё раз, и
--   такая строка попадёт в отчёт, а не уронит вызов.
-- Вход p_rows: jsonb-массив объектов
--   {line, tool_name, daily_rate, deposit, inventory_number, status}.
--   line - номер строки в исходном файле (заголовок - строка 1), по
--   нему пользователь находит ошибку в Excel. status необязателен.
-- Выход: {"inserted": N, "errors": [{"line", "code", "message"}]}, code -
--   SQLSTATE. Приложение различает ошибки по коду и имени ограничения в
--   message, текст из базы пользователю не показывает.
-- security invoker: каждая вставка проходит гранты, политики и триггеры
--   вызывающего, ровно как при прямом INSERT через PostgREST. Права
--   вставлять определяют политики "tools: manager+ inserts" и
--   "manager+ can insert tool units": OPERATOR получит 42501 на каждую
--   строку и в отчёт, и ни одной вставленной строки. Проверка роли в
--   route handler - только быстрый понятный ответ, защита здесь.
-- Блок begin ... exception ... end - подтранзакция. Postgres ставит
--   savepoint при входе в блок с exception; при ошибке внутри откатывает
--   всё, что блок успел записать в БД, и передаёт управление обработчику.
--   Поэтому строка, упавшая на вставке единицы, не оставляет за собой и
--   модель, которую успела создать этой же строкой: вставляется вся строка
--   или ничего. Остальные строки не затронуты, а внешняя транзакция
--   продолжается. Цена: каждый блок с exception - отдельная
--   подтранзакция, на десятки тысяч строк это заметно; для файла в сотни
--   строк несущественно (размер файла ограничивает route handler).
--   Важное следствие: откатывается состояние БД, но не локальные
--   переменные plpgsql. Поэтому счётчик v_inserted увеличивается
--   последним оператором блока (после него ошибки быть не может), а v_line
--   присваивается первым: в обработчике он уже известен.
-- volatile (по умолчанию): функция пишет.
-- search_path = '': полные имена объектов.
-- Модель: ищется по lower(btrim(name)) - то же выражение, что в индексе
--   tools_name_normalized_key. Не нашли - создаём с tool_name (после
--   btrim) и тарифом из файла. Существующая модель не меняется: тариф
--   из файла для неё игнорируется. Импорт заводит единицы, а цену модели
--   меняют осознанно через tools (UPDATE, MANAGER и выше).
--   on conflict do nothing + повторный select: если другой импорт создал
--   ту же модель между нашим select и insert, конфликт не роняет строку,
--   а мы берём уже созданную модель.
-- Статус: только AVAILABLE и UNAVAILABLE. Явная проверка нужна ради
--   понятного текста; без неё RENTED/WRITTEN_OFF остановила бы политика
--   раздела 2 с менее понятным 42501.
-- Что бросает наружу (а не в отчёт): P0001, если p_rows не jsonb-массив.
--   Всё остальное - ошибки строк, внутри отчёта.
create function public.import_tool_units(p_rows jsonb)
    returns jsonb
    language plpgsql
    security invoker
    set search_path = ''
as $$
declare
  v_row      jsonb;
  v_idx      int;
  v_line     int;
  v_name     text;
  v_tool_id  uuid;
  v_status   public.tool_unit_status;
  v_inserted int := 0;
  v_errors   jsonb := '[]'::jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a json array'
      using errcode = 'P0001';
  end if;

  for v_row, v_idx in
    select e.value, e.ordinality::int
    from jsonb_array_elements(p_rows) with ordinality as e(value, ordinality)
  loop
    -- Запасной номер строки на случай, если приведение line ниже упадёт
    -- раньше, чем обработчик успеет его использовать.
    v_line := v_idx;

    begin
      v_line := coalesce((v_row ->> 'line')::int, v_idx);
      -- Модель предыдущей строки не должна перейти в эту.
      v_tool_id := null;

      v_name := btrim(v_row ->> 'tool_name');
      if v_name is null or v_name = '' then
        raise exception 'tool_name is required'
          using errcode = 'P0001';
      end if;

      v_status := coalesce(nullif(btrim(v_row ->> 'status'), ''), 'AVAILABLE')::public.tool_unit_status;
      if v_status not in ('AVAILABLE', 'UNAVAILABLE') then
        raise exception 'import can only create AVAILABLE or UNAVAILABLE units'
          using errcode = 'P0001';
      end if;

      select t.id into v_tool_id
      from public.tools t
      where lower(btrim(t.name)) = lower(v_name);

      if v_tool_id is null then
        insert into public.tools (name, daily_rate, deposit_value)
        values (
          v_name,
          (v_row ->> 'daily_rate')::numeric,
          (v_row ->> 'deposit')::numeric
        )
        on conflict (lower(btrim(name))) do nothing
        returning id into v_tool_id;

        if v_tool_id is null then
          select t.id into v_tool_id
          from public.tools t
          where lower(btrim(t.name)) = lower(v_name);
        end if;
      end if;

      insert into public.tool_units (tool_id, inventory_number, status)
      values (v_tool_id, btrim(v_row ->> 'inventory_number'), v_status);

      -- Последний оператор блока: локальные переменные при откате не
      -- восстанавливаются, счётчик не должен вырасти у упавшей строки.
      v_inserted := v_inserted + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object(
          'line', v_line,
          'code', sqlstate,
          'message', sqlerrm
        )
      );
    end;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'errors', v_errors);
end;
$$;

comment on function public.import_tool_units(jsonb) is
  'Импорт единиц из CSV, вход - jsonb-массив строк с номером line. '
  'Каждая строка в своей подтранзакции (begin ... exception): ошибка '
  'откатывает только её. security invoker - права вставки решают '
  'политики вызывающего. Возвращает {inserted, errors[{line, code, '
  'message}]}, code - SQLSTATE.';

-- Postgres по умолчанию даёт execute на новую функцию роли public, то
-- есть и anon. Отзываем у public и anon, выдаём только authenticated.
-- Без этого вызов anon завершился бы "успешно": обращение к tools внутри
-- каждой строки падало бы с 42501, обработчик записал бы его в отчёт, и
-- клиент получил бы 200 с ошибками в каждой строке вместо отказа на самом
-- вызове.
revoke execute on function public.import_tool_units(jsonb)
  from public, anon;
grant execute on function public.import_tool_units(jsonb)
  to authenticated;
