-- =====================================================================
-- Клиенты и приватное хранилище их фото
--
-- Что делает:
--   1. Тип public.customer_category.
--   2. Таблица public.customers, гранты (часть - на уровне колонок), политики.
--   3. Триггер: категорию существующего клиента меняет только MANAGER и выше.
--   4. Приватный бакет customer-photos и политики на storage.objects.
--
-- Зависит от:
--   20260918094510_staff_and_roles.sql - тип public.staff_role
--                                     и функция public.current_staff_role()
--
-- Как проверить:
--   1. tests/policies/03_customers.sql в SQL Editor - должен отработать без FAIL.
--   2. Dashboard -> Storage: бакет customer-photos помечен как private.
--      (Только смотреть. Все изменения бакета - этой миграцией.)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Категория клиента
-- ---------------------------------------------------------------------

-- Порядок значений ни на что не влияет: категории не сравниваются через
-- < и >, в отличие от staff_role. Grace period по категориям появится
-- на этапе 5 отдельной таблицей или функцией, а не порядком enum.
create type public.customer_category as enum (
  'PLATINUM',
  'GOLD',
  'SILVER',
  'NON_GRATA'
);

comment on type public.customer_category is
  'Категория клиента. Влияет на grace period просрочки (этап 5). '
  'NON_GRATA - клиенту не выдают инструмент.';


-- ---------------------------------------------------------------------
-- 2. Таблица customers
-- ---------------------------------------------------------------------

create table public.customers (
                                  id                  uuid primary key default gen_random_uuid(),
                                  full_name           text not null,
                                  phone               text not null,
                                  category            public.customer_category not null default 'SILVER',
                                  photo_path          text,
                                  document_photo_path text,
                                  created_at          timestamptz not null default now(),

                                  constraint customers_full_name_not_blank
                                      check (btrim(full_name) <> ''),

    -- Формат E.164: "+" и 10-15 цифр. Приложение приводит ввод
    -- ("067 123 45 67") к этому виду до записи; ограничение держит формат
    -- для остальных путей записи (SQL Editor, будущий импорт).
    -- Единый формат нужен для уникальности ниже: иначе "+380671234567"
    -- и "0671234567" - разные строки и один человек заводится дважды.
                                  constraint customers_phone_e164
                                      check (phone ~ '^\+[0-9]{10,15}$'),

  -- Одна карточка на человека. Телефон - то, по чему оператор ищет
  -- клиента на стойке. Дубль позволил бы обойти NON_GRATA: завести
  -- заблокированного клиента заново с чистой категорией.
  constraint customers_phone_key
    unique (phone),

  -- Файлы клиента лежат в папке с его id (см. политику на
  -- storage.objects ниже). Ограничение не даёт привязать к карточке
  -- файл другого клиента: бакет общий, и без этой проверки в photo_path
  -- можно записать любой путь.
  -- В uuid нет символов % и _, поэтому like здесь - точное сравнение
  -- префикса без сюрпризов.
  constraint customers_photo_path_own_folder
    check (photo_path is null or photo_path like id::text || '/%'),
  constraint customers_document_photo_path_own_folder
    check (document_photo_path is null or document_photo_path like id::text || '/%')
);

comment on table public.customers is
  'Клиенты точки проката. Персональные данные: фото лица и документа '
  'лежат в приватном бакете customer-photos.';
comment on column public.customers.phone is
  'Телефон в формате E.164. Уникален: одна карточка на человека.';
comment on column public.customers.category is
  'Новый клиент получает SILVER. Другую категорию назначает '
  'и меняет только MANAGER и выше (политика на INSERT + триггер на UPDATE).';
comment on column public.customers.photo_path is
  'Путь к фото клиента внутри бакета customer-photos, не URL. '
  'URL для показа - signed, генерируется на сервере при каждом запросе.';
comment on column public.customers.document_photo_path is
  'Путь к фото документа внутри бакета customer-photos.';


-- ---------------------------------------------------------------------
-- 2.1 Гранты (первый слой доступа)
-- ---------------------------------------------------------------------

-- INSERT только в содержательные колонки: id и created_at заполняет
-- база. Пути к фото при вставке не передаются вообще: файл можно
-- загрузить только в папку уже существующего клиента.
grant select on public.customers to authenticated;
grant insert (full_name, phone, category) on public.customers to authenticated;

-- UPDATE без id и created_at: идентичность и момент регистрации
-- не меняет никто, поэтому это правило выражено грантом, а не политикой.
grant update (full_name, phone, category, photo_path, document_photo_path)
    on public.customers to authenticated;

-- DELETE не выдан никому из приложения, включая SUPERADMIN.
-- Причины: на этапе 4 на клиента сошлются аренды, и история должна
-- остаться; заблокировать клиента - это NON_GRATA, а не удаление;
-- файлы клиента из Storage через SQL не удаляются, их убирает только
-- Storage API. Если понадобится удаление по запросу клиента -
-- отдельный серверный сценарий суперадмина.
grant select, insert, update on public.customers to service_role;


-- ---------------------------------------------------------------------
-- 2.2 Политики customers
-- ---------------------------------------------------------------------

alter table public.customers enable row level security;

-- SELECT, любой активный сотрудник.
-- USING: current_staff_role() не null = у вызывающего есть активная
--   строка в staff. Видны все клиенты, включая NON_GRATA: оператор
--   должен их видеть, чтобы отказать.
--   (select ...) - InitPlan, функция вызывается один раз на запрос.
-- Негатив: залогиненный без строки в staff - пусто;
--   anon - 42501 на слое грантов, до политик.
create policy "staff can read customers"
on public.customers for select
                                   to authenticated
                                   using ((select public.current_staff_role()) is not null);

-- INSERT, любой активный сотрудник: клиента регистрирует оператор
-- на стойке. Но категорию, отличную от SILVER, назначает MANAGER и выше.
-- WITH CHECK: проверяется вставляемая строка. Для INSERT этого
--   достаточно - старой строки нет.
-- Негатив: оператор вставляет клиента с category = 'GOLD' - 42501;
--   залогиненный без строки в staff - 42501.
create policy "staff can register customers"
on public.customers for insert
to authenticated
with check (
  (select public.current_staff_role()) is not null
  and (
    category = 'SILVER'
    or (select public.current_staff_role()) >= 'MANAGER'
  )
);

-- UPDATE, любой активный сотрудник: исправить имя, телефон, добавить фото.
-- USING: какие строки можно менять - любые, если ты сотрудник.
-- WITH CHECK: та же проверка для новой версии строки.
-- Ограничение на смену категории здесь не выразить: WITH CHECK видит
-- только новую строку и не знает прежнюю категорию. Его держит триггер
-- customers_guard_category ниже.
-- Негатив: залогиненный без строки в staff - 0 строк, без ошибки.
create policy "staff can update customers"
on public.customers for update
                                          to authenticated
                                          using ((select public.current_staff_role()) is not null)
                        with check ((select public.current_staff_role()) is not null);


-- ---------------------------------------------------------------------
-- 3. Триггер: смена категории только для MANAGER и выше
-- ---------------------------------------------------------------------

-- Зачем: категория влияет на деньги (grace period на этапе 5).
--   Оператор, поднявший знакомому категорию до PLATINUM, получил бы
--   бесплатные часы просрочки. Правило "поле изменилось" требует OLD,
--   которого нет в политиках, поэтому это триггер.
-- security invoker: функции не нужны права сверх прав вызывающего.
--   current_staff_role() сама security definer и читает staff.
-- volatile (по умолчанию): триггерной функции stable не нужен,
--   она вызывается один раз на строку.
-- search_path = '': все объекты с полными именами, подмена через
--   объект-двойник в другой схеме невозможна.
-- auth.uid() is null: запрос не от пользователя приложения, а от
--   postgres (миграции, SQL Editor) или service_role (seed). Эти
--   контексты и так обходят RLS целиком, проверять их роль бессмысленно.
-- errcode 42501: тот же код, что у отказа политики. Приложение и тесты
--   обрабатывают любой отказ в правах одинаково.
create function public.customers_guard_category()
    returns trigger
    language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.category is distinct from old.category
     and auth.uid() is not null
     and coalesce(public.current_staff_role() < 'MANAGER', true)
  then
    raise exception 'changing customer category requires MANAGER role'
      using errcode = '42501';
end if;

return new;
end;
$$;

comment on function public.customers_guard_category() is
  'Запрещает смену категории клиента ролям ниже MANAGER.';

-- before: отказ до записи строки.
-- update of category: триггер срабатывает, только если category есть
--   в SET. Правка телефона его не вызывает. Внутри функции ещё проверка
--   distinct from: set category = category ничего не меняет и пропускается.
-- Без триггера: оператор повышает категорию одним UPDATE.
create trigger customers_guard_category
    before update of category on public.customers
    for each row
    execute function public.customers_guard_category();


-- ---------------------------------------------------------------------
-- 4. Приватный бакет и политики на storage.objects
-- ---------------------------------------------------------------------

-- Бакет создаётся миграцией, а не в Dashboard, чтобы воспроизводиться
-- у любого, кто клонирует репозиторий.
-- public = false: файлы недоступны по публичному адресу.
-- file_size_limit: 10 МБ, фото с телефона в него укладываются.
-- allowed_mime_types: только изображения. Storage API проверяет это
--   сам, до политик.
-- on conflict do update: если бакет уже создан руками как public,
--   миграция принудительно делает его приватным, а не молча пропускает.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
           'customer-photos',
           'customer-photos',
           false,
           10 * 1024 * 1024,
           array['image/jpeg', 'image/png', 'image/webp']
       )
    on conflict (id) do update
                            set public             = false,
                            file_size_limit    = excluded.file_size_limit,
                            allowed_mime_types = excluded.allowed_mime_types;

-- INSERT в storage.objects = загрузка файла (upload без upsert).
-- WITH CHECK проверяет строку метаданных загружаемого файла:
--   bucket_id - политики storage.objects общие для всех бакетов
--     и объединяются через OR. Без этого условия политика открыла бы
--     загрузку в любой бакет, включая бакет фото аренд этапа 4.
--   current_staff_role() - загружает только активный сотрудник.
--   exists - первая папка пути является id клиента. Подзапрос идёт
--     через RLS customers: клиент должен быть виден вызывающему.
--     Файл в корне бакета или в папке с произвольным именем отклоняется.
--     objects.name указан с именем таблицы: без него, если у customers
--     появится колонка name, подзапрос молча начнёт сравнивать с ней.
-- UPDATE и DELETE политик нет: файлы неизменяемые. Новое фото -
--   новый файл с новым именем, старый остаётся как история.
--   Следствие: upload с upsert: true не пройдёт.
-- Негатив: оператор загружает 'photo.jpg' (корень) или
--   '<несуществующий uuid>/photo.jpg' - 42501;
--   залогиненный без строки в staff - 42501.
create policy "staff can upload customer photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'customer-photos'
  and (select public.current_staff_role()) is not null
  and exists (
    select 1
    from public.customers c
    where c.id::text = (storage.foldername(objects.name))[1]
  )
);

-- SELECT = скачивание и создание signed URL.
-- createSignedUrl вызывается сессионным клиентом на сервере, поэтому
-- подпись получает только тот, кто проходит эту политику.
-- USING: объект из этого бакета и вызывающий - активный сотрудник.
-- Негатив: залогиненный без строки в staff - пусто (Storage API
--   отвечает "Object not found"); anon - пусто, политики для anon нет.
create policy "staff can read customer photos"
on storage.objects for select
                                         to authenticated
                                         using (
                                         bucket_id = 'customer-photos'
                                         and (select public.current_staff_role()) is not null
                                         );