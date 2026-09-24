import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database';

export type Client = SupabaseClient<Database>;

/**
 * Пять участников матрицы. anon - без входа, только publishable key.
 * inactive - настоящий вход деактивированным оператором (is_active = false):
 * токен выдан и валиден, доступа нет.
 */
export type Actor = 'anon' | 'inactive' | 'OPERATOR' | 'MANAGER' | 'SUPERADMIN';
export const ACTORS: Actor[] = ['anon', 'inactive', 'OPERATOR', 'MANAGER', 'SUPERADMIN'];

/**
 * Что вернул запрос, в терминах, которые различает supabase-js:
 *   allowed   - запрос выполнен, строки или эффект есть;
 *   empty     - SELECT/RPC отработал, но строк нет (RLS отфильтровала всё);
 *   zero_rows - UPDATE/DELETE отработал, но затронул 0 строк (USING не пропустил);
 *   error:<c> - ошибка с кодом c (SQLSTATE, у Storage - 42501 для отказа политики).
 */
export type Outcome = 'allowed' | 'empty' | 'zero_rows' | `error:${string}`;

export type Fixtures = {
    toolId: string;
    toolName: string;
    customerId: string;
    /** Открытая аренда с одной позицией: читают, правят note, оценивают. */
    rentalId: string;
    itemId: string;
    /** Закрытая аренда: в неё нельзя добавить позицию. */
    closedRentalId: string;
    graceSilver: number;
    customerPhotoPath: string;
    rentalPhotoPath: string;
};

export type Ctx = {
    runId: string;
    clients: Record<Actor, Client>;
    /** auth.uid() участника; у anon его нет. */
    uid: Record<Actor, string | null>;
    fx: Fixtures;
    /** Уникальное для прогона имя: повторный прогон не сталкивается с прошлым. */
    name(label: string): string;
    uniq(): string;
    make: {
        tool(): Promise<string>;
        unit(status?: 'AVAILABLE' | 'WRITTEN_OFF'): Promise<string>;
        customer(): Promise<string>;
        rental(): Promise<{ rentalId: string; itemId: string; unitId: string }>;
        /** Пользователь Auth без строки в staff. */
        authUser(): Promise<string>;
        /** Пользователь Auth со строкой в staff. */
        staffRow(role: 'OPERATOR' | 'MANAGER' | 'SUPERADMIN'): Promise<{ uid: string; email: string }>;
    };
    trackOpenItem(rentalId: string, itemId: string): void;
    trackFile(bucket: string, path: string): void;
    admin: Client;
    signIn(email: string): Promise<Client>;
};

export type Check = {
    id: string;
    group: string;
    /** Что проверяется, по-человечески: строка попадает в отчёт для заказчика. */
    description: string;
    /** Какой механизм за это отвечает: политика, грант, триггер. */
    why: string;
    expected: Record<Actor, Outcome>;
    run(client: Client, ctx: Ctx, actor: Actor): Promise<Outcome>;
};
