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

Готово. Миграция `pricing_and_overdue`: таблица `category_grace_periods`
(seed по 4 категориям, гранты и политики по образцу `tools`), снимки
`rentals.grace_hours`/`rental_items.daily_rate` (backfill, потом
`NOT NULL`), `rental_items.amount` и ограничение
`rental_items_amount_matches_return`, чистая `immutable`-функция
`calc_rental_amount()`, триггеры `rentals_set_grace_hours`,
`rental_items_set_daily_rate`, `rental_items_set_return_amount` (порядок
с `rental_items_set_return` этапа 4 держит имя), `security invoker`
RPC `rental_estimate()`.

Решения: снимок тарифа и grace в момент создания строки, а не
пересчёт по текущим значениям - сумма выданной или закрытой аренды не
меняется задним числом; расчёт при возврате - отдельный триггер, а не
расширение `rental_items_set_return` этапа 4 (не редактируется
applied-миграция без найденной в ней ошибки); `rental_estimate()` для
закрытых позиций берёт сумму из сохранённого `amount`, а не
пересчитывает - защита от той же проблемы на уровне формулы целиком,
если `calc_rental_amount()` когда-нибудь заменят.

Интерфейс: `/settings/grace` (таблица grace по категориям, правка для
`MANAGER+`), карточка аренды - сумма по каждой позиции и итог
(`rental_estimate`), grace клиента в шапке, возврат - сумма к оплате по
отмеченным позициям до подтверждения.

Проверка: `tests/pricing/05_calc.sql` (десять граничных случаев чистой
функции), `tests/policies/05_pricing.sql` и три предыдущих файла - без
`FAIL`; `npx tsc --noEmit`, `npm run lint`, `npm run build` - без ошибок;
`npm run seed:staff` - два прогона подряд без ошибок.

Находка по ходу: `LATERAL` в `UPDATE ... FROM` не может ссылаться на
цель обновления (`42P10`), почина - независимый экземпляр таблицы в
подзапросе (`docs/rls-notes.md`, `docs/book/05-pricing.md` раздел 7).

## Этап 6. Аудит-лог

Готово. Миграция `audit_log`: таблица `audit_log` (гранты - только
SELECT для `authenticated`, ничего для `anon`/`service_role`; политика
SELECT - только SUPERADMIN, политик на запись нет вообще), универсальная
триггерная функция `audit_log_row()` (`security definer`, одна на все
таблицы через `TG_TABLE_NAME`/`TG_OP`/`TG_ARGV`/`to_jsonb`), семь
триггеров `audit_*` на `staff`, `tools`, `tool_units`, `customers`,
`rentals`, `rental_items`, `category_grace_periods`.

Решения: `changed_fields` считается сравнением `jsonb` NEW/OLD, а не по
факту наличия колонки в `SET` (та же ловушка, что с `update of <col>` в
главах 3-4, здесь она затронула бы куда больше событий); `row_pk` -
`text`, чтобы подойти и `uuid`-таблицам, и `category_grace_periods.category`
(enum); `actor_id` без внешнего ключа на `staff` - лог обязан пережить
удаление строки сотрудника, имя для интерфейса получают отдельным
запросом.

Интерфейс: `/audit`, только SUPERADMIN (защита - политика, скрытие
пункта меню - UX), фильтры по таблице/сотруднику/дате, раскрытие записи -
diff по `changed_fields` для UPDATE, полный снимок для INSERT/DELETE,
пагинация по `id`.

Проверка: `tests/policies/06_audit.sql` и все предыдущие файлы - без
`FAIL`; `npx tsc --noEmit`, `npm run lint`, `npm run build` - без ошибок;
`npm run seed:staff` - два прогона подряд без ошибок.

Находка по ходу: тест изначально проверял содержимое `audit_log` под той
же ролью (`OPERATOR`), что совершила действие, - политика пускает к
логу только SUPERADMIN, даже к записям о собственных действиях автора
(`docs/rls-notes.md`, `docs/book/06-audit-log.md` раздел 7).

## Этап 7. Дашборд, единицы, импорт, QR

Готово. Миграция `dashboard_and_import`: уникальный индекс
`tools_name_normalized_key` по `lower(btrim(name))`, замена политики INSERT
на `tool_units` (только `AVAILABLE` и `UNAVAILABLE`), view
`dashboard_counts` с `security_invoker = true`, `security invoker` RPC
`import_tool_units(jsonb)` (каждая строка в своём блоке
`begin ... exception`, отчёт `{inserted, errors[{line, code, message}]}`).

Решения: `security_invoker` вместо `security definer` с ручной проверкой
роли; просрочка в дашборде без grace, как в `isOverdue()` интерфейса;
существующая модель не меняется импортом; дыра "единицу можно завести сразу
`RENTED`" закрыта политикой, а не переписыванием миграции этапа 4; QR
содержит URL с `id`, а не инвентарный номер.

Интерфейс: `/dashboard` (счётчики, просроченные аренды), `/tools/[id]`
(единицы модели, добавление, смена статуса, списание с подтверждением),
`/units/[id]` (карточка, текущая аренда, история, QR, кнопки "Issue" и
"Accept return"), `/tools/import` (route handler
`/api/import/tool-units`: предпросмотр и импорт, `;` и `,`, BOM,
десятичная запятая, Windows-1251 как запасной вариант),
`/tools/print-labels` (наклейки на A4, без навигации в печати).
`/rentals/new?unit=<id>` предвыбирает единицу.

Проверка: `tests/policies/07_dashboard_import.sql` и все предыдущие файлы -
без `FAIL` (через `npx supabase db query --linked -f`, `psql` в окружении
нет); `npx tsc --noEmit`, `npm run lint`, `npm run build` - без ошибок;
route handler проверен `curl` с cookie тестовых сотрудников (401/403/400,
предпросмотр и два импорта подряд файла-примера), страницы - на
собранном `next start` под двумя ролями, печатная страница наклеек - снимком
экрана в режиме печати.

Находка по ходу: в фикстуре теста строка импорта, где ломался тариф, не
доказывала откат подтранзакции (падала до создания модели), пришлось
добавить строку с корректным тарифом и дублем номера единицы.

## Этап 8. Матрица прав через API и README

Готово. Все этапы 0-8 закрыты.

Сид: четвёртый пользователь, деактивированный оператор
(`inactive@example.com`). `tests/api/`: матрица данными (`matrix.ts`, 62
проверки, 5 участников: anon, деактивированный, OPERATOR, MANAGER,
SUPERADMIN), логин настоящими JWT, таблица в консоль и отчёт
`docs/policy-matrix-report.md`, ненулевой код при расхождении; сценарий
"деактивация на лету" (один токен до и после). Скрипты: `test:sql` (все
SQL-тесты по порядку, `psql` или запасной путь через
`supabase db query --linked`), `test:api`, `test:all`, `check:bundle`
(`next build`, поиск secret key, пароля сида и `service_role` в
`.next/static`, проверка имён `NEXT_PUBLIC_*`). `tests/manual/`:
`break-policy.sql`, `restore-policy.sql`, `cleanup-matrix-data.sql`.
`README.md` по разделу 7 плана.

Находка: у `tool_units` была политика DELETE для SUPERADMIN без гранта
DELETE, удалить единицу не мог никто. Исправлено миграцией
`grant_delete_tool_units`, регрессия - `tests/policies/08_tool_units_delete.sql`.

Проверка: `npm run test:sql` - 8 файлов без `FAIL`; `npm run test:api` - 310
ячеек совпали, два прогона подряд; сломанная политика
(`break-policy.sql`) даёт ровно одно расхождение (`tools.insert`, OPERATOR),
после `restore-policy.sql` снова 0; `npm run check:bundle` - секретов в
бандле нет; `npx tsc --noEmit`, `npm run lint` - без ошибок.
