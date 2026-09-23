# Прогресс

## Этап 0. Поднять и осмотреться

Готово. Облачный проект Supabase (Frankfurt) вместо локального стека в Docker. Проект Next.js с `--src-dir`, TypeScript, Tailwind, shadcn/ui, Supabase CLI в dev-зависимостях, `supabase link` на облачный проект. Ключи: publishable для браузера, secret только на сервере. Отключены автоматическая выдача прав и автоматическое включение RLS для новых таблиц.

## Этап 1. Одна таблица и первая политика

Готово. Миграция `create_tools`: таблица, `enable row level security`, грант на select для `authenticated`, политика `"authenticated can read tools"`. Демонстрационные миграции `grant_anon_read_tools` и `revoke_anon_read_tools` - разбор двух слоёв доступа. Клиенты Supabase (браузерный, серверный, админский), `proxy.ts` для обновления сессии, вход и выход через server actions, layout панели, список инструмента в серверном компоненте.

Проверено curl: anon получает `42501`, чтение с токеном возвращает строки. Ключ формата `sb_publishable_` не JWT и передаётся сразу в `apikey` и `Authorization`.

## Этап 2. Роли

Готово. Миграция `staff_and_roles`: enum `staff_role` (OPERATOR < MANAGER < SUPERADMIN), таблица `staff`, функция `current_staff_role()` (`security definer`, `stable`, `search_path = ''`), политики по матрице прав на `staff` и `tools`. Отдельная миграция с грантами: без них политики падают на первом слое.

Решения: роль хранится в таблице, а не в JWT (понижение прав действует сразу). Строку в `staff` создаёт суперадмин, самостоятельная регистрация выключена в Dashboard, первый суперадмин - через `npm run seed:staff` с service_role.

Проверка: `tests/policies/02_roles.sql`, три роли на одних и тех же действиях. Типы сгенерированы в `src/types/database.ts`.

## Этап 3. Клиенты и приватный Storage

Готово. Миграция `customers_and_storage`: enum `customer_category`, таблица `customers` (телефон в E.164 и уникален, пути к фото ограничены папкой клиента), гранты в том числе на уровне колонок, политики, триггер `customers_guard_category`, приватный бакет `customer-photos` и политики на `storage.objects`.

Интерфейс: список клиентов с поиском, регистрация с загрузкой фото клиента и документа прямо из браузера, карточка с показом фото через signed URL.

Проверка: `tests/policies/03_customers.sql`; curl на публичный адрес и на адрес без сессии файл не отдаёт; signed URL перестаёт открываться через минуту.

## Этап 3b. Сайдбар, лого и английский интерфейс

Готово. SQL и миграций нет. Весь интерфейс переведён на английский по
единому словарю терминов, название приложения - Tool Rental. Верхняя
панель заменена сайдбаром (десктоп) и выезжающим меню поверх контента
(мобильный, `Sheet` на Base UI Dialog), меню задаётся массивом в
`src/components/layout/nav-config.ts`. Лого (`src/components/brand/logo.tsx`)
и favicon (`src/app/icon.svg`), синий акцент вместо дефолтного
почти-чёрного в `globals.css`. `src/lib/format.ts` (деньги и даты,
локаль `en-GB`, UAH) и `src/lib/db-errors.ts` (русские тексты ошибок из
применённых миграций переводятся по SQLSTATE и имени ограничения, а не
показываются как есть).

Проверка: `npx tsc --noEmit`, `npm run lint`, `npm run build` - без
ошибок; поиск кириллицы вне комментариев по `src/` пуст; вход и переходы
между Tools и Customers проверены визуально на странице `/login`
(десктоп) - экран за сессией (`/tools`, `/customers`) требует входа
тестовым пользователем, руками проверяет Олег по чек-листу задания.

## Этап 4. Аренда: выдача и возврат

Готово. Миграции: `tool_units_and_rentals` (таблицы `tool_units`,
`rentals`, `rental_items`, частичный уникальный индекс
`rental_items_active_unit`, триггеры `tool_units_guard_status`,
`rentals_guard_customer`, `rental_items_set_return`,
`rental_items_sync_unit`), `rentals_rpc_and_storage` (RPC `issue_rental`,
`return_rental_items`, бакет `rental-photos`). Плюс две небольшие
миграции по ходу: грант `service_role` на `rental_items` и исправление
`tool_units_guard_status` для no-op `UPDATE` статуса (обе истории -
`docs/rls-notes.md`).

Решения: статус `tool_units` - производная от данных `rental_items`, а
не флаг; выдача и возврат - RPC для атомарности, но без расширения прав
(`security invoker`); позиция аренды пишется политикой, а не триггером
(нет `OLD` у `INSERT`).

Интерфейс: `/rentals` (список, фильтр по статусу, просрочка подсвечена),
`/rentals/new` (поиск клиента, выбор единиц с поиском, фото на каждую),
`/rentals/[id]` (карточка, частичный возврат с фото), аренды клиента - в
его карточке. Сид дополнен тестовыми моделями и единицами
(`npm run seed:staff`).

Проверка: `tests/policies/04_rentals.sql` и оба предыдущих файла - без
`FAIL`; `npx tsc --noEmit`, `npm run lint`, `npm run build` - без ошибок;
`npm run seed:staff` - три прогона подряд без ошибок.

## Этап 5. Тариф и просрочка

Не начат.

## Этап 6. Аудит-лог

Не начат.

## Этап 7. Дашборд и импорт

Не начат.

## Этап 8. Проверка политик и README

Не начат.
