create table public.tools
(
    id            uuid primary key        default gen_random_uuid(),
    name          text           not null,
    daily_rate    numeric(10, 2) not null check (daily_rate >= 0),
    deposit_value numeric(10, 2) not null check (deposit_value >= 0),
    created_at    timestamptz    not null default now()
);

alter table public.tools enable row level security;

-- Первый слой доступа: право на таблицу у роли, под которой ходит PostgREST.
-- Авто-выдачу прав при создании проекта мы отключили, поэтому grant пишем сами.
grant select on public.tools to authenticated;

-- Второй слой: какие строки эта роль видит.
create
policy "authenticated can read tools"
on public.tools
for
select to authenticated using (true);