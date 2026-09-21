import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const password = process.env.SEED_PASSWORD;

if (!url || !serviceKey || !password) {
    throw new Error('Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SEED_PASSWORD');
}

const USERS = [
    { email: 'operator@example.com', full_name: 'Тест Оператор', role: 'OPERATOR' },
    { email: 'manager@example.com', full_name: 'Тест Менеджер', role: 'MANAGER' },
    { email: 'admin@example.com', full_name: 'Тест Суперадмин', role: 'SUPERADMIN' },
] as const;

// service_role обходит RLS: скрипт создаёт первого суперадмина,
// которого иначе создать некому.
const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureUser(email: string): Promise<string> {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;

    const existing = data.users.find((u) => u.email === email);
    if (existing) return existing.id;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    if (createError) throw createError;
    return created.user.id;
}

async function main() {
    for (const u of USERS) {
        const userId = await ensureUser(u.email);
        const { error } = await admin
            .from('staff')
            .upsert({ user_id: userId, full_name: u.full_name, role: u.role, is_active: true });
        if (error) throw error;
        console.log(`${u.role.padEnd(10)} ${u.email}  ${userId}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});