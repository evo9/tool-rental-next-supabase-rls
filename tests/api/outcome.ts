import type { Outcome } from './types';

// Классификация ответов supabase-js. Главное различие, ради которого
// матрица существует: "запрещено" (error.code) и "пусто" (data: [], count 0)
// - разные ответы, и RLS даёт то или другое в зависимости от слоя:
//   нет гранта -> ошибка 42501 (до политик);
//   грант есть, политика не пропустила SELECT -> [] без ошибки;
//   грант есть, USING не пропустил UPDATE/DELETE -> count 0 без ошибки;
//   WITH CHECK не пропустил INSERT/UPDATE -> ошибка 42501.

type PgError = { code?: string; message?: string } | null;

export function errorOutcome(error: NonNullable<PgError>): Outcome {
    return `error:${error.code || 'unknown'}`;
}

/** SELECT: ошибка, пустой массив или строки. */
export function selectOutcome(res: { data: unknown[] | null; error: PgError }): Outcome {
    if (res.error) return errorOutcome(res.error);
    return res.data && res.data.length > 0 ? 'allowed' : 'empty';
}

/**
 * INSERT/UPDATE/DELETE с { count: 'exact' }: ошибка, 0 строк или успех.
 * Без count PostgREST не сообщает, сколько строк затронуто, и "0 строк"
 * не отличить от успеха - поэтому count запрашивается в каждой проверке.
 */
export function writeOutcome(res: { count: number | null; error: PgError }): Outcome {
    if (res.error) return errorOutcome(res.error);
    return res.count === 0 ? 'zero_rows' : 'allowed';
}

/** RPC: ошибка, пустой набор (для функций, возвращающих таблицу) или результат. */
export function rpcOutcome(res: { data: unknown; error: PgError }): Outcome {
    if (res.error) return errorOutcome(res.error);
    if (Array.isArray(res.data) && res.data.length === 0) return 'empty';
    return 'allowed';
}

type StorageErr = { message?: string; statusCode?: string | number; status?: number } | null;

function storageStatus(error: NonNullable<StorageErr>): number {
    return Number(error.statusCode ?? error.status ?? 0);
}

/**
 * Storage API отвечает не SQLSTATE, а HTTP-статусом. Отказ политики
 * (403 или текст про row-level security) сводится к 42501 - так же, как
 * тот же отказ выглядит в PostgREST. "Объект не найден" для чтения - это
 * "пусто": RLS не различает "нет файла" и "нет права его видеть".
 */
export function storageOutcome(res: { error: StorageErr }, mode: 'read' | 'write'): Outcome {
    if (!res.error) return 'allowed';
    const status = storageStatus(res.error);
    const text = res.error.message ?? '';
    if (mode === 'read' && (status === 404 || /not found/i.test(text))) return 'empty';
    if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(text)) {
        return 'error:42501';
    }
    return `error:storage-${status || 'unknown'}`;
}
