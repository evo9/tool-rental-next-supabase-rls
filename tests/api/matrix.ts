import { randomUUID } from 'node:crypto';
import { errorOutcome, rpcOutcome, selectOutcome, storageOutcome, writeOutcome } from './outcome';
import { CUSTOMER_PHOTOS, PNG, RENTAL_PHOTOS } from './context';
import type { Actor, Check, Client, Ctx, Outcome } from './types';

// Матрица прав данными: каждая проверка - одно действие, ожидание для каждого
// из пяти участников. Тексты description и why попадают в
// docs/policy-matrix-report.md и написаны по-английски: отчёт читает
// заказчик. Комментарии в коде - по-русски. Подробно: docs/book/08-policy-matrix.md.
//
// Проверки, которые меняют данные, работают на данных этого прогона
// (ctx.make.*) и вносят в cleanup то, что можно убрать. Проверки записи
// намеренно "тихие": UPDATE пишет то же значение, что уже стоит, чтобы
// поломанная политика не оставила после себя испорченных данных.

const DENY: Outcome = 'error:42501';

/** Пять ожиданий в порядке: anon, inactive, OPERATOR, MANAGER, SUPERADMIN. */
const row = (anon: Outcome, inactive: Outcome, operator: Outcome, manager: Outcome, superadmin: Outcome) =>
    ({ anon, inactive, OPERATOR: operator, MANAGER: manager, SUPERADMIN: superadmin }) satisfies Record<Actor, Outcome>;

// Типовые строки матрицы. Они повторяются по всей схеме, потому что схема
// устроена по одному образцу: слой грантов (anon -> 42501), слой политик
// (не-сотрудник -> пусто / 0 строк / 42501 на INSERT).
const READ_STAFF = row(DENY, 'empty', 'allowed', 'allowed', 'allowed');
const WRITE_STAFF = row(DENY, DENY, 'allowed', 'allowed', 'allowed'); // INSERT
const UPDATE_STAFF = row(DENY, 'zero_rows', 'allowed', 'allowed', 'allowed');
const INSERT_MANAGER = row(DENY, DENY, DENY, 'allowed', 'allowed');
const UPDATE_MANAGER = row(DENY, 'zero_rows', 'zero_rows', 'allowed', 'allowed');
const DELETE_SUPERADMIN = row(DENY, 'zero_rows', 'zero_rows', 'zero_rows', 'allowed');
const NOBODY = row(DENY, DENY, DENY, DENY, DENY); // нет гранта ни у кого
// Storage: у anon грант на storage.objects есть (выдан Supabase), политики для
// него нет, поэтому чтение даёт "не найдено", а не 42501 (в отличие от таблиц public).
const STORAGE_READ = row('empty', 'empty', 'allowed', 'allowed', 'allowed');
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const soon = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const me = (ctx: Ctx, actor: Actor) => ctx.uid[actor] ?? ZERO_UUID;

// --- tools ---------------------------------------------------------------

const tools: Check[] = [
    {
        id: 'tools.select',
        group: 'tools',
        description: 'Read the tool catalogue',
        why: 'policy "tools: staff reads"; anon has no grant',
        expected: READ_STAFF,
        run: async (c) => selectOutcome(await c.from('tools').select('id').limit(1)),
    },
    {
        id: 'tools.insert',
        group: 'tools',
        description: 'Add a tool model',
        why: 'policy "tools: manager+ inserts" (WITH CHECK)',
        expected: INSERT_MANAGER,
        run: async (c, ctx) =>
            writeOutcome(
                await c.from('tools').insert({ name: ctx.name('tool'), daily_rate: 1, deposit_value: 1 }, { count: 'exact' }),
            ),
    },
    {
        id: 'tools.update',
        group: 'tools',
        description: 'Change a tool model (same values written back)',
        why: 'policy "tools: manager+ updates" (USING filters the row: 0 rows, no error)',
        expected: UPDATE_MANAGER,
        run: async (c, ctx) =>
            writeOutcome(await c.from('tools').update({ daily_rate: 100 }, { count: 'exact' }).eq('id', ctx.fx.toolId)),
    },
    {
        id: 'tools.delete',
        group: 'tools',
        description: 'Delete a tool model',
        why: 'policy "tools: superadmin deletes"',
        expected: DELETE_SUPERADMIN,
        run: async (c, ctx) =>
            writeOutcome(await c.from('tools').delete({ count: 'exact' }).eq('id', await ctx.make.tool())),
    },
];

// --- tool_units ----------------------------------------------------------

const toolUnits: Check[] = [
    {
        id: 'tool_units.select',
        group: 'tool_units',
        description: 'Read tool units',
        why: 'policy "staff can read tool units"',
        expected: READ_STAFF,
        run: async (c) => selectOutcome(await c.from('tool_units').select('id').limit(1)),
    },
    {
        id: 'tool_units.insert',
        group: 'tool_units',
        description: 'Add a unit as AVAILABLE',
        why: 'policy "manager+ can insert tool units"',
        expected: INSERT_MANAGER,
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('tool_units')
                    .insert({ tool_id: ctx.fx.toolId, inventory_number: ctx.name('unit') }, { count: 'exact' }),
            ),
    },
    {
        id: 'tool_units.insert-rented',
        group: 'tool_units',
        description: 'Add a unit that is already RENTED (no rental behind it)',
        why: 'WITH CHECK allows only AVAILABLE/UNAVAILABLE on insert (stage 7); the status trigger fires on UPDATE only',
        expected: NOBODY,
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('tool_units')
                    .insert({ tool_id: ctx.fx.toolId, inventory_number: ctx.name('unit'), status: 'RENTED' }, { count: 'exact' }),
            ),
    },
    {
        id: 'tool_units.update-status',
        group: 'tool_units',
        description: 'Mark a free unit UNAVAILABLE',
        why: 'policy "manager+ can update tool units"',
        expected: UPDATE_MANAGER,
        run: async (c, ctx) =>
            writeOutcome(
                await c.from('tool_units').update({ status: 'UNAVAILABLE' }, { count: 'exact' }).eq('id', await ctx.make.unit()),
            ),
    },
    {
        id: 'tool_units.set-rented-by-hand',
        group: 'tool_units',
        description: 'Set RENTED by hand on a unit that has no active rental',
        why: 'trigger tool_units_guard_status (P0001) after the policy lets a manager touch the row',
        expected: row(DENY, 'zero_rows', 'zero_rows', 'error:P0001', 'error:P0001'),
        run: async (c, ctx) =>
            writeOutcome(
                await c.from('tool_units').update({ status: 'RENTED' }, { count: 'exact' }).eq('id', await ctx.make.unit()),
            ),
    },
    {
        id: 'tool_units.revive-written-off',
        group: 'tool_units',
        description: 'Change the status of a WRITTEN_OFF unit',
        why: 'trigger tool_units_guard_status: WRITTEN_OFF is final (P0001)',
        expected: row(DENY, 'zero_rows', 'zero_rows', 'error:P0001', 'error:P0001'),
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('tool_units')
                    .update({ status: 'AVAILABLE' }, { count: 'exact' })
                    .eq('id', await ctx.make.unit('WRITTEN_OFF')),
            ),
    },
    {
        id: 'tool_units.delete',
        group: 'tool_units',
        description: 'Delete a unit that was never rented',
        why: 'policy "superadmin can delete tool units"',
        expected: DELETE_SUPERADMIN,
        run: async (c, ctx) =>
            writeOutcome(await c.from('tool_units').delete({ count: 'exact' }).eq('id', await ctx.make.unit())),
    },
];

// --- customers -----------------------------------------------------------

const newPhone = () => `+3809${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

const customers: Check[] = [
    {
        id: 'customers.select',
        group: 'customers',
        description: 'Read customers',
        why: 'policy "staff can read customers"',
        expected: READ_STAFF,
        run: async (c) => selectOutcome(await c.from('customers').select('id').limit(1)),
    },
    {
        id: 'customers.insert-silver',
        group: 'customers',
        description: 'Register a customer (default SILVER category)',
        why: 'policy "staff can register customers"',
        expected: WRITE_STAFF,
        run: async (c, ctx) =>
            writeOutcome(
                await c.from('customers').insert({ full_name: ctx.name('customer'), phone: newPhone() }, { count: 'exact' }),
            ),
    },
    {
        id: 'customers.insert-gold',
        group: 'customers',
        description: 'Register a customer directly as GOLD',
        why: 'WITH CHECK of "staff can register customers": other categories need MANAGER+',
        expected: INSERT_MANAGER,
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('customers')
                    .insert({ full_name: ctx.name('customer'), phone: newPhone(), category: 'GOLD' }, { count: 'exact' }),
            ),
    },
    {
        id: 'customers.update-name',
        group: 'customers',
        description: 'Correct a customer name',
        why: 'policy "staff can update customers"',
        expected: UPDATE_STAFF,
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('customers')
                    .update({ full_name: ctx.name('customer renamed') }, { count: 'exact' })
                    .eq('id', await ctx.make.customer()),
            ),
    },
    {
        id: 'customers.update-category',
        group: 'customers',
        description: 'Change a customer category',
        why: 'trigger customers_guard_category: the policy cannot see the old value (42501)',
        expected: row(DENY, 'zero_rows', DENY, 'allowed', 'allowed'),
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('customers')
                    .update({ category: 'GOLD' }, { count: 'exact' })
                    .eq('id', await ctx.make.customer()),
            ),
    },
    {
        id: 'customers.update-created-at',
        group: 'customers',
        description: 'Rewrite the registration timestamp',
        why: 'column-level grant: created_at is not updatable by anyone',
        expected: NOBODY,
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('customers')
                    .update({ created_at: new Date().toISOString() }, { count: 'exact' })
                    .eq('id', ctx.fx.customerId),
            ),
    },
    {
        id: 'customers.delete',
        group: 'customers',
        description: 'Delete a customer',
        why: 'no DELETE grant for anyone: history must stay, NON_GRATA is the way to block',
        expected: NOBODY,
        run: async (c, ctx) =>
            writeOutcome(await c.from('customers').delete({ count: 'exact' }).eq('id', ctx.fx.customerId)),
    },
];

// --- staff ---------------------------------------------------------------

const staff: Check[] = [
    {
        id: 'staff.read-own',
        group: 'staff',
        description: 'Read your own staff row',
        why: 'policy "staff: read own row" (works even when deactivated, so the UI can say so)',
        expected: row(DENY, 'allowed', 'allowed', 'allowed', 'allowed'),
        run: async (c, ctx, actor) =>
            selectOutcome(await c.from('staff').select('user_id').eq('user_id', me(ctx, actor))),
    },
    {
        id: 'staff.read-others',
        group: 'staff',
        description: "Read other people's staff rows",
        why: 'policy "staff: superadmin reads all"',
        expected: row(DENY, 'empty', 'empty', 'empty', 'allowed'),
        run: async (c, ctx, actor) =>
            selectOutcome(await c.from('staff').select('user_id').neq('user_id', me(ctx, actor))),
    },
    {
        id: 'staff.insert',
        group: 'staff',
        description: 'Give a user a staff role',
        why: 'policy "staff: superadmin inserts"',
        expected: row(DENY, DENY, DENY, DENY, 'allowed'),
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('staff')
                    .insert({ user_id: await ctx.make.authUser(), full_name: ctx.name('staff'), role: 'OPERATOR' }, { count: 'exact' }),
            ),
    },
    {
        id: 'staff.promote-self',
        group: 'staff',
        description: 'Set your own role to SUPERADMIN',
        why: 'policy "staff: superadmin updates" (USING); for a SUPERADMIN this is a no-op',
        expected: row(DENY, 'zero_rows', 'zero_rows', 'zero_rows', 'allowed'),
        run: async (c, ctx, actor) =>
            writeOutcome(
                await c.from('staff').update({ role: 'SUPERADMIN' }, { count: 'exact' }).eq('user_id', me(ctx, actor)),
            ),
    },
    {
        id: 'staff.demote-self',
        group: 'staff',
        description: 'Lower your own role (a superadmin cannot lock the system)',
        why: 'WITH CHECK of "staff: superadmin updates": own row must stay SUPERADMIN and active',
        expected: row(DENY, 'zero_rows', 'zero_rows', 'zero_rows', DENY),
        run: async (c, ctx, actor) =>
            writeOutcome(
                await c.from('staff').update({ role: 'OPERATOR' }, { count: 'exact' }).eq('user_id', me(ctx, actor)),
            ),
    },
    {
        id: 'staff.deactivate-self',
        group: 'staff',
        description: 'Deactivate yourself',
        why: 'WITH CHECK of "staff: superadmin updates"',
        expected: row(DENY, 'zero_rows', 'zero_rows', 'zero_rows', DENY),
        run: async (c, ctx, actor) =>
            writeOutcome(
                await c.from('staff').update({ is_active: false }, { count: 'exact' }).eq('user_id', me(ctx, actor)),
            ),
    },
    {
        id: 'staff.delete-other',
        group: 'staff',
        description: "Delete someone else's staff row",
        why: 'policy "staff: superadmin deletes others"',
        expected: DELETE_SUPERADMIN,
        run: async (c, ctx) =>
            writeOutcome(
                await c.from('staff').delete({ count: 'exact' }).eq('user_id', (await ctx.make.staffRow('OPERATOR')).uid),
            ),
    },
    {
        id: 'staff.delete-self',
        group: 'staff',
        description: 'Delete your own staff row',
        why: 'same policy excludes the caller own row',
        expected: row(DENY, 'zero_rows', 'zero_rows', 'zero_rows', 'zero_rows'),
        run: async (c, ctx, actor) =>
            writeOutcome(await c.from('staff').delete({ count: 'exact' }).eq('user_id', me(ctx, actor))),
    },
];

// --- category_grace_periods ---------------------------------------------

const grace: Check[] = [
    {
        id: 'grace.select',
        group: 'category_grace_periods',
        description: 'Read grace periods',
        why: 'policy "staff can read grace periods"',
        expected: READ_STAFF,
        run: async (c) => selectOutcome(await c.from('category_grace_periods').select('category')),
    },
    {
        id: 'grace.update',
        group: 'category_grace_periods',
        description: 'Change a grace period (same value written back)',
        why: 'policy "manager+ can update grace periods"',
        expected: UPDATE_MANAGER,
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('category_grace_periods')
                    .update({ grace_hours: ctx.fx.graceSilver }, { count: 'exact' })
                    .eq('category', 'SILVER'),
            ),
    },
    {
        id: 'grace.insert',
        group: 'category_grace_periods',
        description: 'Add a category row',
        why: 'no INSERT grant: the rows mirror the customer_category enum',
        expected: NOBODY,
        run: async (c) =>
            writeOutcome(await c.from('category_grace_periods').insert({ category: 'SILVER', grace_hours: 3 }, { count: 'exact' })),
    },
    {
        id: 'grace.delete',
        group: 'category_grace_periods',
        description: 'Delete a category row',
        why: 'no DELETE grant',
        expected: NOBODY,
        run: async (c) =>
            writeOutcome(await c.from('category_grace_periods').delete({ count: 'exact' }).eq('category', 'NON_GRATA')),
    },
];

// --- rentals, rental_items, RPC -----------------------------------------

const rentals: Check[] = [
    {
        id: 'rentals.select',
        group: 'rentals',
        description: 'Read rentals',
        why: 'policy "staff can read rentals"',
        expected: READ_STAFF,
        run: async (c) => selectOutcome(await c.from('rentals').select('id').limit(1)),
    },
    {
        id: 'rental_items.select',
        group: 'rentals',
        description: 'Read rental items',
        why: 'policy "staff can read rental items"',
        expected: READ_STAFF,
        run: async (c) => selectOutcome(await c.from('rental_items').select('id').limit(1)),
    },
    {
        id: 'rentals.update-note',
        group: 'rentals',
        description: 'Edit the note of a rental',
        why: 'policy "staff can update rental note"; note is the only granted column',
        expected: UPDATE_STAFF,
        run: async (c, ctx) =>
            writeOutcome(await c.from('rentals').update({ note: 'matrix' }, { count: 'exact' }).eq('id', ctx.fx.rentalId)),
    },
    {
        id: 'rentals.update-status',
        group: 'rentals',
        description: 'Close a rental by writing status directly',
        why: 'column-level grant: only the trigger rental_items_sync_unit writes status',
        expected: NOBODY,
        run: async (c, ctx) =>
            writeOutcome(await c.from('rentals').update({ status: 'CLOSED' }, { count: 'exact' }).eq('id', ctx.fx.rentalId)),
    },
    {
        id: 'rentals.delete',
        group: 'rentals',
        description: 'Delete a rental',
        why: 'no DELETE grant: rental history is never deleted',
        expected: NOBODY,
        run: async (c, ctx) =>
            writeOutcome(await c.from('rentals').delete({ count: 'exact' }).eq('id', ctx.fx.closedRentalId)),
    },
    {
        id: 'rental_items.delete',
        group: 'rentals',
        description: 'Delete a rental item',
        why: 'no DELETE grant',
        expected: NOBODY,
        run: async (c, ctx) =>
            writeOutcome(await c.from('rental_items').delete({ count: 'exact' }).eq('id', ctx.fx.itemId)),
    },
    {
        id: 'rental_items.insert-into-closed',
        group: 'rentals',
        description: 'Add an item straight into a CLOSED rental (bypassing the RPC)',
        why: 'WITH CHECK of "staff can add items to active rentals"',
        expected: NOBODY,
        run: async (c, ctx) =>
            writeOutcome(
                await c
                    .from('rental_items')
                    // daily_rate в сгенерированном типе обязателен, но его ставит триггер
                    // (клиенту колонка не грантована) - тип обходим, а не подставляем значение,
                    // иначе отказ дал бы грант на колонку, а не политика.
                    .insert({ rental_id: ctx.fx.closedRentalId, tool_unit_id: await ctx.make.unit() } as never, { count: 'exact' }),
            ),
    },
    {
        id: 'rpc.issue_rental',
        group: 'rentals',
        description: 'Issue a rental (RPC issue_rental)',
        why: 'security invoker: inserts run through the caller policies; execute revoked from anon',
        expected: WRITE_STAFF,
        run: async (c, ctx) => {
            const res = await c.rpc('issue_rental', {
                p_customer_id: ctx.fx.customerId,
                p_planned_return_at: soon(),
                p_unit_ids: [await ctx.make.unit()],
            });
            // Успешно выданную аренду закроет cleanup: иначе единица осталась бы RENTED.
            if (!res.error) for (const r of res.data) ctx.trackOpenItem(r.rental_id, r.rental_item_id);
            return rpcOutcome(res);
        },
    },
    {
        id: 'rpc.return_rental_items',
        group: 'rentals',
        description: 'Accept a return (RPC return_rental_items)',
        why: 'security invoker: a deactivated user cannot even see the item, so the RPC reports "not visible" (P0001)',
        expected: row(DENY, 'error:P0001', 'allowed', 'allowed', 'allowed'),
        run: async (c, ctx) => {
            const { rentalId, itemId } = await ctx.make.rental();
            return rpcOutcome(
                await c.rpc('return_rental_items', {
                    p_items: [{ item_id: itemId, photo_path: `${rentalId}/${itemId}/return-matrix.png` }],
                }),
            );
        },
    },
    {
        id: 'rpc.rental_estimate',
        group: 'rentals',
        description: 'Estimate the amount of a rental (RPC rental_estimate)',
        why: 'security invoker: RLS inside the function hides the rows from non-staff',
        expected: READ_STAFF,
        run: async (c, ctx) => rpcOutcome(await c.rpc('rental_estimate', { p_rental_id: ctx.fx.rentalId })),
    },
];

// --- audit_log -----------------------------------------------------------

const audit: Check[] = [
    {
        id: 'audit_log.select',
        group: 'audit_log',
        description: 'Read the audit log',
        why: 'policy "superadmin reads audit log"; the grant exists, so others get an empty result',
        expected: row(DENY, 'empty', 'empty', 'empty', 'allowed'),
        run: async (c) => selectOutcome(await c.from('audit_log').select('id').limit(1)),
    },
    {
        id: 'audit_log.insert',
        group: 'audit_log',
        description: 'Forge an audit entry',
        why: 'no INSERT grant for anyone: only the audit_log_row() trigger writes',
        expected: NOBODY,
        run: async (c) =>
            writeOutcome(await c.from('audit_log').insert({ table_name: 'x', op: 'INSERT', row_pk: '1' }, { count: 'exact' })),
    },
    {
        id: 'audit_log.update',
        group: 'audit_log',
        description: 'Edit an audit entry',
        why: 'no UPDATE grant for anyone',
        expected: NOBODY,
        run: async (c) =>
            writeOutcome(await c.from('audit_log').update({ op: 'UPDATE' }, { count: 'exact' }).eq('id', -1)),
    },
    {
        id: 'audit_log.delete',
        group: 'audit_log',
        description: 'Delete an audit entry',
        why: 'no DELETE grant for anyone',
        expected: NOBODY,
        run: async (c) => writeOutcome(await c.from('audit_log').delete({ count: 'exact' }).eq('id', -1)),
    },
];

// --- view и импорт -------------------------------------------------------

const views: Check[] = [
    {
        id: 'dashboard_counts.select',
        group: 'dashboard and import',
        description: 'Read dashboard counters ("empty" = a row of zeros)',
        why: 'security_invoker view: base-table RLS applies to the caller; anon has no grant on the view',
        expected: READ_STAFF,
        run: async (c) => {
            const { data, error } = await c.from('dashboard_counts').select('*').single();
            if (error) return errorOutcome(error);
            const values = Object.values(data).map((v) => Number(v ?? 0));
            // Не-сотрудник получает ОДНУ строку из нулей, а не пустой ответ:
            // агрегат по нулю видимых строк всегда даёт строку.
            return values.every((v) => v === 0) ? 'empty' : 'allowed';
        },
    },
    {
        id: 'rpc.import_tool_units',
        group: 'dashboard and import',
        description: 'Import a unit from CSV (RPC import_tool_units; every row rejected = 42501)',
        why: 'security invoker: row inserts pass through "manager+" policies; the report carries the per-row errors',
        expected: INSERT_MANAGER,
        run: async (c, ctx) => {
            const res = await c.rpc('import_tool_units', {
                p_rows: [
                    {
                        line: 2,
                        tool_name: ctx.fx.toolName,
                        daily_rate: 100,
                        deposit: 1000,
                        inventory_number: ctx.name('imported unit'),
                    },
                ],
            });
            if (res.error) return errorOutcome(res.error);
            const report = res.data as { inserted: number; errors: { code: string }[] };
            if (report.inserted > 0 && report.errors.length === 0) return 'allowed';
            if (report.inserted === 0 && report.errors.length > 0 && report.errors.every((e) => e.code === '42501')) {
                return 'error:42501';
            }
            return `error:report-${report.errors[0]?.code ?? 'empty'}`;
        },
    },
];

// --- Storage -------------------------------------------------------------

const storageRead = async (c: Client, bucket: string, path: string): Promise<Outcome> =>
    storageOutcome(await c.storage.from(bucket).download(path), 'read');

/**
 * Одинаковый набор проверок для обоих приватных бакетов. Различаются
 * только пути: customer-photos - <customer_id>/<файл>, rental-photos -
 * <rental_id>/<item_id>/<файл>.
 */
function storageChecks(bucket: string, ownPath: (ctx: Ctx) => string, foreignPath: (ctx: Ctx) => string, fixturePath: (ctx: Ctx) => string): Check[] {
    const g = `storage: ${bucket}`;
    const upload = async (c: Client, ctx: Ctx, path: string, upsert = false): Promise<Outcome> => {
        const res = await c.storage.from(bucket).upload(path, PNG, { contentType: 'image/png', upsert });
        if (!res.error) ctx.trackFile(bucket, path);
        return storageOutcome(res, 'write');
    };

    return [
        {
            id: `${bucket}.upload-own-folder`,
            group: g,
            description: 'Upload a file into the folder of an existing record',
            why: 'policy on storage.objects INSERT: path must start with an existing folder',
            expected: WRITE_STAFF,
            run: (c, ctx) => upload(c, ctx, ownPath(ctx)),
        },
        {
            id: `${bucket}.upload-foreign-folder`,
            group: g,
            description: 'Upload into a folder that does not belong to any record',
            why: 'same policy: the exists() subquery finds nothing',
            expected: NOBODY,
            run: (c, ctx) => upload(c, ctx, foreignPath(ctx)),
        },
        {
            id: `${bucket}.upload-root`,
            group: g,
            description: 'Upload into the root of the bucket',
            why: 'same policy: the first path segment is not a record id',
            expected: NOBODY,
            run: (c, ctx) => upload(c, ctx, `root-${ctx.uniq()}.png`),
        },
        {
            id: `${bucket}.download`,
            group: g,
            description: 'Download an existing file',
            why: 'policy on storage.objects SELECT; hidden objects look like "not found"',
            expected: STORAGE_READ,
            run: (c, ctx) => storageRead(c, bucket, fixturePath(ctx)),
        },
        {
            id: `${bucket}.signed-url`,
            group: g,
            description: 'Create a signed URL for an existing file',
            why: 'signing goes through the same SELECT policy',
            expected: STORAGE_READ,
            run: async (c, ctx) =>
                storageOutcome(await c.storage.from(bucket).createSignedUrl(fixturePath(ctx), 60), 'read'),
        },
        {
            id: `${bucket}.signed-url-fetch`,
            group: g,
            description: 'Open a signed URL with no session at all (it is a bearer link)',
            why: 'the link works for whoever holds it, but only staff can create one; 60 s lifetime',
            expected: STORAGE_READ,
            run: async (c, ctx) => {
                const res = await c.storage.from(bucket).createSignedUrl(fixturePath(ctx), 60);
                if (res.error) return storageOutcome(res, 'read');
                const http = await fetch(res.data.signedUrl);
                return http.ok ? 'allowed' : `error:http-${http.status}`;
            },
        },
        {
            id: `${bucket}.overwrite`,
            group: g,
            description: 'Overwrite an existing file (upsert)',
            why: 'no UPDATE policy: files are immutable',
            expected: NOBODY,
            run: (c, ctx) => upload(c, ctx, fixturePath(ctx), true),
        },
        {
            id: `${bucket}.remove`,
            group: g,
            description: 'Delete an existing file',
            why: 'no DELETE policy: the API reports zero removed objects',
            expected: row('zero_rows', 'zero_rows', 'zero_rows', 'zero_rows', 'zero_rows'),
            run: async (c, ctx) => {
                const res = await c.storage.from(bucket).remove([fixturePath(ctx)]);
                if (res.error) return storageOutcome(res, 'write');
                return res.data.length === 0 ? 'zero_rows' : 'allowed';
            },
        },
    ];
}

const storage: Check[] = [
    ...storageChecks(
        CUSTOMER_PHOTOS,
        (ctx) => `${ctx.fx.customerId}/photo-${ctx.uniq()}.png`,
        () => `${randomUUID()}/photo.png`,
        (ctx) => ctx.fx.customerPhotoPath,
    ),
    ...storageChecks(
        RENTAL_PHOTOS,
        (ctx) => `${ctx.fx.rentalId}/${ctx.fx.itemId}/issue-${ctx.uniq()}.png`,
        // Своя аренда, но позиция другая: папка второго уровня не найдётся.
        (ctx) => `${ctx.fx.rentalId}/${randomUUID()}/issue-${ctx.uniq()}.png`,
        (ctx) => ctx.fx.rentalPhotoPath,
    ),
];

export const CHECKS: Check[] = [
    ...tools,
    ...toolUnits,
    ...customers,
    ...staff,
    ...grace,
    ...rentals,
    ...audit,
    ...views,
    ...storage,
];
