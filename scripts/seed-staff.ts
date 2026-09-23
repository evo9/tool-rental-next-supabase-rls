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

// Тестовый инвентарь для этапа 4: нет интерфейса управления моделями
// и единицами (появится на этапе 7), поэтому это единственный способ
// получить данные для ручной проверки /rentals/new без SQL Editor.
// Одна единица UNAVAILABLE и одна WRITTEN_OFF - проверить, что RPC
// issue_rental отказывает им обеим (P0001).
const TOOLS = [
    {
        name: 'Rotary hammer',
        daily_rate: 250,
        deposit_value: 3000,
        units: [
            { inventory_number: 'RH-001' },
            { inventory_number: 'RH-002' },
            { inventory_number: 'RH-003' },
        ],
    },
    {
        name: 'Impact driver',
        daily_rate: 150,
        deposit_value: 1500,
        units: [
            { inventory_number: 'ID-001' },
            { inventory_number: 'ID-002', status: 'UNAVAILABLE', note: 'Chuck needs repair' },
        ],
    },
    {
        name: 'Angle grinder',
        daily_rate: 120,
        deposit_value: 1200,
        units: [
            { inventory_number: 'AG-001' },
            { inventory_number: 'AG-002' },
            { inventory_number: 'AG-003', status: 'WRITTEN_OFF', note: 'Motor burned out' },
        ],
    },
    {
        name: 'Lawn mower',
        daily_rate: 400,
        deposit_value: 5000,
        units: [{ inventory_number: 'LM-001' }, { inventory_number: 'LM-002' }],
    },
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

// tools не имеет уникального ограничения на name (в отличие от
// tool_units.inventory_number), поэтому не ON CONFLICT, а поиск вручную -
// тот же приём, что ensureUser для auth.users.
async function ensureTool(name: string, dailyRate: number, depositValue: number): Promise<string> {
    const { data: existing, error: selectError } = await admin
        .from('tools')
        .select('id')
        .eq('name', name)
        .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return existing.id;

    const { data: created, error: insertError } = await admin
        .from('tools')
        .insert({ name, daily_rate: dailyRate, deposit_value: depositValue })
        .select('id')
        .single();
    if (insertError) throw insertError;
    return created.id;
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

    for (const tool of TOOLS) {
        const toolId = await ensureTool(tool.name, tool.daily_rate, tool.deposit_value);
        console.log(`tool       ${tool.name}  ${toolId}`);

        for (const unit of tool.units) {
            const { error } = await admin.from('tool_units').upsert(
                {
                    tool_id: toolId,
                    inventory_number: unit.inventory_number,
                    status: 'status' in unit ? unit.status : 'AVAILABLE',
                    note: 'note' in unit ? unit.note : null,
                },
                { onConflict: 'inventory_number' },
            );
            if (error) throw error;
            console.log(`  unit     ${unit.inventory_number}`);
        }
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});