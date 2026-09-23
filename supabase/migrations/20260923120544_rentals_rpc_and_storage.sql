-- =====================================================================
-- Этап 4. Аренда: выдача и возврат (часть 2 из 2)
--
-- Что делает:
--   1. RPC public.issue_rental() - аренда и все её позиции одной
--      транзакцией.
--   2. RPC public.return_rental_items() - возврат нескольких позиций
--      одним вызовом.
--   3. Приватный бакет rental-photos и политики на storage.objects.
--
-- Зависит от:
--   20260923120539_tool_units_and_rentals.sql - public.rentals,
--     public.rental_items, public.tool_units и их триггеры.
--   20260921200621_customers_and_storage.sql - public.customers (для
--     приёма Storage-путей).
--
-- Новое в этой миграции (подробно в docs/book/04-rentals.md):
--   RPC как способ провести несколько вставок одной транзакцией без
--   расширения прав вызывающего.
--
-- Как проверить:
--   psql "$DB_URL" -f tests/policies/04_rentals.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. RPC: выдача аренды
-- ---------------------------------------------------------------------

-- Подробно: docs/book/04-rentals.md, раздел "RPC и атомарность выдачи".
-- Зачем RPC, а не серия отдельных INSERT из приложения: выдача - это
--   аренда плюс N позиций, и всё это должно попасть в базу вместе или
--   не попасть вообще. Несколько отдельных запросов от клиента такой
--   гарантии не дают - сеть может оборваться между вставкой аренды и
--   частью позиций, и в базе останется аренда без части единиц. Один
--   вызов RPC выполняется в одной транзакции Postgres целиком.
-- security invoker: RPC ничего не обходит - каждая вставка внутри неё
--   проходит те же гранты, политики и триггеры, что прошла бы, приди
--   она отдельным запросом через PostgREST. Прямые INSERT минуя эту
--   функцию дают тот же результат (tests/policies/04_rentals.sql,
--   блок "без RPC").
-- p_unit_ids проверяется на пустоту и повтор до первой вставки: пустой
--   массив дал бы бессмысленную аренду без единиц, повтор - вторая
--   вставка той же единицы упала бы на partial unique индексе с менее
--   понятным 23505 вместо явного текста здесь.
-- volatile: plpgsql-функции volatile по умолчанию, не stable и не
--   immutable - тело делает запись.
create function public.issue_rental(
    p_customer_id uuid,
    p_planned_return_at timestamptz,
    p_unit_ids uuid[]
)
    returns table (rental_id uuid, rental_item_id uuid, tool_unit_id uuid)
    language plpgsql
    security invoker
    set search_path = ''
as $$
declare
  v_rental_id uuid;
  v_unit_id uuid;
begin
  if p_unit_ids is null or array_length(p_unit_ids, 1) is null then
    raise exception 'select at least one tool unit'
      using errcode = 'P0001';
  end if;

  if (
    select count(distinct u) from unnest(p_unit_ids) as u
  ) <> array_length(p_unit_ids, 1) then
    raise exception 'the same tool unit is listed twice'
      using errcode = 'P0001';
  end if;

  insert into public.rentals (customer_id, planned_return_at)
  values (p_customer_id, p_planned_return_at)
  returning id into v_rental_id;

  foreach v_unit_id in array p_unit_ids
  loop
    insert into public.rental_items (rental_id, tool_unit_id)
    values (v_rental_id, v_unit_id)
    returning id into rental_item_id;

    rental_id := v_rental_id;
    tool_unit_id := v_unit_id;
    return next;
  end loop;
end;
$$;

comment on function public.issue_rental(uuid, timestamptz, uuid[]) is
  'Аренда и все её позиции одной транзакцией. security invoker - каждая '
  'вставка внутри проходит те же гранты и политики, что и напрямую.';

-- Supabase по умолчанию выдаёт execute на новую функцию роли public.
-- anon функция не нужна: у него и так нет гранта на insert в rentals.
revoke execute on function public.issue_rental(uuid, timestamptz, uuid[])
  from public, anon;
grant execute on function public.issue_rental(uuid, timestamptz, uuid[])
  to authenticated;


-- ---------------------------------------------------------------------
-- 2. RPC: возврат нескольких позиций
-- ---------------------------------------------------------------------

-- Подробно: тот же приём атомарности, что у issue_rental выше.
-- p_items - jsonb-массив объектов {item_id, photo_path}, а не два
--   параллельных массива: одна структура на одну позицию читается без
--   риска перепутать порядок item_id[3] с photo_path[3].
-- Проверки по порядку: пустой список; повтор одной позиции дважды (тот
--   же приём, что дубли единиц в issue_rental); позиция не существует
--   или не видна вызывающему; позиции из разных аренд одним вызовом -
--   иначе один запрос мог бы закрыть чужой список позиций сразу по
--   нескольким арендам, и разобраться с фронта, что пошло не так,
--   было бы сложнее, чем с одной явной ошибкой здесь.
-- return_photo_path может прийти null - тогда сработает check
--   rental_items_return_requires_photo (23514): возврат без фото
--   невозможен и через RPC.
-- returned_at всё равно перезапишет rental_items_set_return - сюда
--   пишем текущее время, лишь бы отличалось от null.
create function public.return_rental_items(p_items jsonb)
    returns void
    language plpgsql
    security invoker
    set search_path = ''
as $$
declare
  v_item_count int := jsonb_array_length(p_items);
  v_distinct_item_ids int;
  v_matched_count int;
  v_rental_count int;
begin
  if v_item_count is null or v_item_count = 0 then
    raise exception 'select at least one item to return'
      using errcode = 'P0001';
  end if;

  select count(distinct (item ->> 'item_id')::uuid)
  into v_distinct_item_ids
  from jsonb_array_elements(p_items) as item;

  if v_distinct_item_ids <> v_item_count then
    raise exception 'the same item is listed twice'
      using errcode = 'P0001';
  end if;

  select count(*), count(distinct ri.rental_id)
  into v_matched_count, v_rental_count
  from public.rental_items ri
  join jsonb_array_elements(p_items) as item
    on ri.id = (item ->> 'item_id')::uuid;

  if v_matched_count <> v_item_count then
    raise exception 'one of the items does not exist or is not visible'
      using errcode = 'P0001';
  end if;

  if v_rental_count <> 1 then
    raise exception 'all items must belong to the same rental'
      using errcode = 'P0001';
  end if;

  update public.rental_items ri
  set return_photo_path = item ->> 'photo_path',
      returned_at = now()
  from jsonb_array_elements(p_items) as item
  where ri.id = (item ->> 'item_id')::uuid;
end;
$$;

comment on function public.return_rental_items(jsonb) is
  'Возврат нескольких позиций одним вызовом, все - из одной аренды. '
  'returned_at/returned_by в записанной строке всё равно перезаписывает '
  'rental_items_set_return.';

revoke execute on function public.return_rental_items(jsonb) from public, anon;
grant execute on function public.return_rental_items(jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Приватный бакет и политики на storage.objects
-- ---------------------------------------------------------------------

-- Тот же приём, что у customer-photos (этап 3, там разобран подробно):
-- приватный бакет, лимит размера и MIME - на уровне Storage API, путь -
-- дисциплина имён, а не файловая иерархия.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rental-photos',
  'rental-photos',
  false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- INSERT = загрузка фото выдачи или возврата (upload без upsert).
-- WITH CHECK проверяет строку метаданных загружаемого файла:
--   bucket_id - политики storage.objects общие для всех бакетов и
--     объединяются через OR (этап 3). Без условия политика открыла бы
--     загрузку и в customer-photos.
--   current_staff_role() - загружает только активный сотрудник.
--   exists - первая папка пути - id существующей аренды, вторая - id
--     позиции именно этой аренды. Подзапрос идёт через RLS rental_items:
--     если бы позиция принадлежала другой аренде, exists не нашёл бы
--     строку с обоими условиями сразу, даже если каждое по отдельности
--     существует где-то ещё.
-- UPDATE и DELETE политик нет: файлы неизменяемые, как у customer-photos.
-- Негатив: путь с несуществующей арендой, с позицией чужой аренды или
--   без файла в корне бакета - 42501; залогиненный без staff - 42501.
create policy "staff can upload rental photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'rental-photos'
  and (select public.current_staff_role()) is not null
  and exists (
    select 1
    from public.rental_items ri
    where ri.rental_id::text = (storage.foldername(objects.name))[1]
      and ri.id::text = (storage.foldername(objects.name))[2]
  )
);

-- SELECT = скачивание и создание signed URL, тот же приём, что у
-- customer-photos: подпись создаётся сессионным клиентом на сервере,
-- получает её только тот, кто и так проходит эту политику.
-- Негатив: залогиненный без staff - пусто; anon - пусто (грант на
--   storage.objects у него есть от Supabase, политики - нет).
create policy "staff can read rental photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'rental-photos'
  and (select public.current_staff_role()) is not null
);
