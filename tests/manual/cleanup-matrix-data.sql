-- =====================================================================
-- Уборка данных, которые оставляет npm run test:api.
--
-- Что делает:
--   Удаляет клиентов, аренды, позиции, единицы и модели с префиксом
--   __matrix- (так называет всё, что создаёт прогон матрицы). Через API
--   их не удалить: на DELETE у rentals, rental_items и customers нет
--   гранта ни у кого, это часть проверяемого поведения. Выполняется под
--   postgres (владелец таблиц, RLS и гранты его не касаются).
--   Записи audit_log об этих строках остаются: лог не подделывается и не
--   чистится.
--
-- Когда нужно: по желанию, если в интерфейсе мешают закрытые аренды
--   "__matrix-...". На корректность повторных прогонов не влияет: каждый
--   прогон работает под собственным префиксом.
--
-- Как использовать:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/manual/cleanup-matrix-data.sql
-- =====================================================================
begin;

-- Порядок обратный зависимостям (внешние ключи on delete restrict):
-- позиции -> аренды -> единицы -> клиенты -> модели.
delete from public.rental_items
where rental_id in (
  select r.id from public.rentals r
  join public.customers c on c.id = r.customer_id
  where starts_with(c.full_name, '__matrix-')
);

delete from public.rentals
where customer_id in (
  select id from public.customers where starts_with(full_name, '__matrix-')
);

delete from public.tool_units where starts_with(inventory_number, '__matrix-');
delete from public.customers where starts_with(full_name, '__matrix-');
delete from public.tools where starts_with(name, '__matrix-');

commit;
