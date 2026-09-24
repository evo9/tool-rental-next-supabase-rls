import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';
import type { Client } from './types';

// Клиенты созданы напрямую, а не из src/lib/supabase: это скрипт, а не код
// приложения, ему нужен вход по паролю без cookies и без Next.

export const EMAILS = {
    inactive: 'inactive@example.com',
    OPERATOR: 'operator@example.com',
    MANAGER: 'manager@example.com',
    SUPERADMIN: 'admin@example.com',
} as const;

export function loadEnv() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    const password = process.env.SEED_PASSWORD;
    if (!url || !publishableKey || !secretKey || !password) {
        throw new Error(
            'Нужны NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SEED_PASSWORD (.env.local)',
        );
    }
    return { url, publishableKey, secretKey, password };
}

const authOptions = { persistSession: false, autoRefreshToken: false } as const;

/** Без входа: только publishable key, роль anon. */
export function anonClient(): Client {
    const env = loadEnv();
    return createClient<Database>(env.url, env.publishableKey, { auth: authOptions });
}

/**
 * service_role: обходит RLS. Здесь только подготовка и уборка данных
 * (пользователи Auth, файлы Storage, is_active); сами проверки идут от
 * имени участников матрицы.
 */
export function adminClient(): Client {
    const env = loadEnv();
    return createClient<Database>(env.url, env.secretKey, { auth: authOptions });
}

/** Настоящий вход по паролю: JWT выдаёт Auth, клиент дальше ходит с ним. */
export async function signIn(email: string): Promise<Client> {
    const env = loadEnv();
    const client = createClient<Database>(env.url, env.publishableKey, {
        auth: authOptions,
    });
    const { error } = await client.auth.signInWithPassword({ email, password: env.password });
    if (error) throw new Error(`Вход ${email} не удался: ${error.message}. Запускали npm run seed:staff?`);
    return client;
}
