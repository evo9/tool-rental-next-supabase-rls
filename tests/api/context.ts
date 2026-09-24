import { ACTORS, type Actor, type Client, type Ctx, type Fixtures } from './types';
import { EMAILS, adminClient, anonClient, loadEnv, signIn } from './clients';

// 1x1 PNG: содержимое неважно, важен тип image/png (бакеты принимают только изображения).
export const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

export const CUSTOMER_PHOTOS = 'customer-photos';
export const RENTAL_PHOTOS = 'rental-photos';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Фикстура, без которой прогон бессмыслен, - ошибка сразу, с контекстом. */
function must<T>(label: string, res: { data: T | null; error: { message: string } | null }): T {
    if (res.error || res.data === null) throw new Error(`Подготовка данных (${label}): ${res.error?.message ?? 'пустой ответ'}`);
    return res.data;
}

/**
 * Готовит данные прогона и возвращает контекст. Данные создаются обычными
 * сессиями сотрудников через API (кроме пользователей Auth и файлов в
 * Storage: их заводит service_role). Всё, что создано, имеет префикс
 * `__matrix-<runId>`: повторный прогон не пересекается с прошлым, а
 * cleanup() убирает то, что политики позволяют убрать. Аренды и клиентов
 * не удалить никому (гранта на DELETE нет) - они остаются закрытыми
 * записями с этим префиксом; их убирает tests/manual/cleanup-matrix-data.sql.
 */
export async function createContext(): Promise<{ ctx: Ctx; cleanup: () => Promise<string[]> }> {
    const env = loadEnv();
    const admin = adminClient();
    const runId = Date.now().toString(36);
    const prefix = `__matrix-${runId}`;
    let counter = 0;

    const clients: Record<Actor, Client> = {
        anon: anonClient(),
        inactive: await signIn(EMAILS.inactive),
        OPERATOR: await signIn(EMAILS.OPERATOR),
        MANAGER: await signIn(EMAILS.MANAGER),
        SUPERADMIN: await signIn(EMAILS.SUPERADMIN),
    };

    const uid = { anon: null } as unknown as Record<Actor, string | null>;
    for (const actor of ACTORS) {
        if (actor === 'anon') continue;
        const { data, error } = await clients[actor].auth.getUser();
        if (error || !data.user) throw new Error(`Нет пользователя для ${actor}: ${error?.message}`);
        uid[actor] = data.user.id;
    }

    const openItems: { rentalId: string; itemId: string }[] = [];
    const files: { bucket: string; path: string }[] = [];
    const authUsers: string[] = [];

    const name = (label: string) => `${prefix}-${counter++} ${label}`;
    const uniq = () => `${runId}-${counter++}`;

    async function createAuthUser(email: string) {
        const res = await admin.auth.admin.createUser({ email, password: env.password, email_confirm: true });
        if (res.error) throw new Error(`Подготовка данных (пользователь Auth): ${res.error.message}`);
        authUsers.push(res.data.user.id);
        return res.data.user;
    }

    const make: Ctx['make'] = {
        async tool() {
            const res = await clients.MANAGER
                .from('tools')
                .insert({ name: name('tool'), daily_rate: 100, deposit_value: 1000 })
                .select('id')
                .single();
            return must('tool', res).id;
        },
        async unit(status = 'AVAILABLE') {
            const res = await clients.MANAGER
                .from('tool_units')
                .insert({ tool_id: fx.toolId, inventory_number: name('unit') })
                .select('id')
                .single();
            const id = must('unit', res).id;
            if (status === 'WRITTEN_OFF') {
                // Политика INSERT не пускает WRITTEN_OFF сразу - только через UPDATE.
                const upd = await clients.MANAGER.from('tool_units').update({ status }).eq('id', id);
                if (upd.error) throw new Error(`Подготовка данных (списание): ${upd.error.message}`);
            }
            return id;
        },
        async customer() {
            const phone = `+3809${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
            const res = await clients.OPERATOR
                .from('customers')
                .insert({ full_name: name('customer'), phone })
                .select('id')
                .single();
            return must('customer', res).id;
        },
        async rental() {
            const unitId = await make.unit();
            const res = await clients.OPERATOR.rpc('issue_rental', {
                p_customer_id: fx.customerId,
                p_planned_return_at: new Date(Date.now() + DAY_MS).toISOString(),
                p_unit_ids: [unitId],
            });
            const row = must('issue_rental', res)[0];
            openItems.push({ rentalId: row.rental_id, itemId: row.rental_item_id });
            return { rentalId: row.rental_id, itemId: row.rental_item_id, unitId };
        },
        async authUser() {
            return (await createAuthUser(`${prefix}-${counter++}@example.com`)).id;
        },
        async staffRow(role) {
            const email = `${prefix}-${counter++}@example.com`;
            const user = await createAuthUser(email);
            const res = await admin.from('staff').insert({ user_id: user.id, full_name: name('staff'), role });
            if (res.error) throw new Error(`Подготовка данных (staff): ${res.error.message}`);
            return { uid: user.id, email };
        },
    };

    // --- фикстуры ------------------------------------------------------
    const toolName = name('fixture tool');
    const toolRes = await clients.MANAGER
        .from('tools')
        .insert({ name: toolName, daily_rate: 100, deposit_value: 1000 })
        .select('id')
        .single();
    const toolId = must('fixture tool', toolRes).id;

    // fx нужен фабрикам выше (make.unit берёт fx.toolId), поэтому объект
    // создаётся заранее и достраивается по мере готовности данных.
    const fx = { toolId, toolName } as Fixtures;

    fx.customerId = await make.customer();
    const rental = await make.rental();
    fx.rentalId = rental.rentalId;
    fx.itemId = rental.itemId;

    const closed = await make.rental();
    fx.closedRentalId = closed.rentalId;
    const ret = await clients.MANAGER.rpc('return_rental_items', {
        p_items: [{ item_id: closed.itemId, photo_path: `${closed.rentalId}/${closed.itemId}/return-matrix.png` }],
    });
    if (ret.error) throw new Error(`Подготовка данных (возврат): ${ret.error.message}`);

    const grace = await clients.MANAGER.from('category_grace_periods').select('grace_hours').eq('category', 'SILVER').single();
    fx.graceSilver = must('grace', grace).grace_hours;

    fx.customerPhotoPath = `${fx.customerId}/photo-${uniq()}.png`;
    fx.rentalPhotoPath = `${fx.rentalId}/${fx.itemId}/issue-${uniq()}.png`;
    for (const [bucket, path] of [
        [CUSTOMER_PHOTOS, fx.customerPhotoPath],
        [RENTAL_PHOTOS, fx.rentalPhotoPath],
    ] as const) {
        const up = await admin.storage.from(bucket).upload(path, PNG, { contentType: 'image/png' });
        if (up.error) throw new Error(`Подготовка данных (файл ${bucket}): ${up.error.message}`);
        files.push({ bucket, path });
    }

    const ctx: Ctx = {
        runId,
        clients,
        uid,
        fx,
        name,
        uniq,
        make,
        trackOpenItem: (rentalId, itemId) => void openItems.push({ rentalId, itemId }),
        trackFile: (bucket, path) => void files.push({ bucket, path }),
        admin,
        signIn,
    };

    async function cleanup(): Promise<string[]> {
        const notes: string[] = [];

        // 1. Открытые аренды закрываем: иначе единицы остались бы RENTED, а
        //    аренды - в счётчиках "активные" на дашборде. Уже возвращённые
        //    позиции отвечают P0001 - это нормально, игнорируем.
        for (const { rentalId, itemId } of openItems) {
            await clients.MANAGER.rpc('return_rental_items', {
                p_items: [{ item_id: itemId, photo_path: `${rentalId}/${itemId}/return-cleanup.png` }],
            });
        }

        // 2. Файлы Storage: сессии сотрудников удалять их не могут (политик на
        //    DELETE нет, это часть проверяемого поведения), service_role может.
        for (const bucket of [CUSTOMER_PHOTOS, RENTAL_PHOTOS]) {
            const paths = files.filter((f) => f.bucket === bucket).map((f) => f.path);
            if (paths.length > 0) await admin.storage.from(bucket).remove(paths);
        }

        // 3. Строки staff и пользователи Auth, заведённые прогоном. Строку
        //    staff удаляет SUPERADMIN (политика), service_role права DELETE
        //    не имеет; пока строка есть, пользователя Auth не удалить (FK).
        for (const userId of authUsers) {
            await clients.SUPERADMIN.from('staff').delete().eq('user_id', userId);
            const del = await admin.auth.admin.deleteUser(userId);
            if (del.error) notes.push(`пользователь Auth ${userId}: ${del.error.message}`);
        }

        // 4. Единицы и модели прогона удаляет SUPERADMIN, по одной. Одним
        //    запросом нельзя: единица с историей аренд даёт 23503 (внешний ключ
        //    on delete restrict), и упавший запрос откатил бы удаление всех
        //    остальных. Выдававшиеся единицы и их модели остаются.
        const units = await clients.SUPERADMIN.from('tool_units').select('id').like('inventory_number', `${prefix}%`);
        for (const { id } of units.data ?? []) await clients.SUPERADMIN.from('tool_units').delete().eq('id', id);
        const models = await clients.SUPERADMIN.from('tools').select('id').like('name', `${prefix}%`);
        for (const { id } of models.data ?? []) await clients.SUPERADMIN.from('tools').delete().eq('id', id);

        const left = await clients.SUPERADMIN.from('tool_units').select('id', { count: 'exact', head: true }).like('inventory_number', `${prefix}%`);
        if (left.count) notes.push(`осталось ${left.count} единиц с префиксом ${prefix} (участвовали в арендах)`);
        notes.push(`клиенты и аренды прогона остаются с префиксом ${prefix} (tests/manual/cleanup-matrix-data.sql)`);
        return notes;
    }

    return { ctx, cleanup };
}

