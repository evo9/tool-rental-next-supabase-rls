import { createClient } from '@/lib/supabase/server';
import { describeDbError } from '@/lib/db-errors';
import { getCurrentStaffRole } from '@/features/staff/queries';
import { hasRole } from '@/lib/roles';
import {
    CsvFileError,
    MAX_FILE_BYTES,
    parseImportCsv,
} from '@/features/import/parse-csv';
import type { ImportPreview, ImportReport, ImportReportError } from '@/features/import/types';

/**
 * POST /api/import/tool-units?mode=preview|import, multipart, поле "file".
 *
 * Route handler, а не server action: загрузке нужны свои коды ответа (400
 * плохой файл, 403 роль, 413 размер), ответ - структурированный отчёт, и
 * эндпоинт проверяется curl без браузера. Подробно: docs/book/07-*.md.
 *
 * Клиент Supabase - сессионный, не admin: вставки идут от имени пользователя,
 * RLS работает. Проверка роли ниже - UX (быстрый понятный 403 вместо отчёта
 * из сотни одинаковых 42501); защита - политики "tools: manager+ inserts" и
 * "manager+ can insert tool units": оператор, обошедший эту проверку, получит
 * в отчёте 42501 на каждой строке и ни одной вставленной.
 * Пользователя без сессии до сюда не пускает proxy.ts.
 */
export async function POST(request: Request) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });

    const role = await getCurrentStaffRole();
    if (!hasRole(role, 'MANAGER')) {
        return Response.json({ error: 'Only a manager or above can import tools.' }, { status: 403 });
    }

    const preview = new URL(request.url).searchParams.get('mode') === 'preview';

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'Attach a CSV file.' }, { status: 400 });
    // Размер проверяется до разбора файла. formData() уже принял тело целиком,
    // так что это защита разбора, а не сети: лимит тела запроса - забота платформы.
    if (file.size > MAX_FILE_BYTES) {
        return Response.json({ error: 'The file is larger than 1 MB.' }, { status: 413 });
    }

    let parsed;
    try {
        parsed = parseImportCsv(await file.arrayBuffer());
    } catch (e) {
        if (e instanceof CsvFileError) return Response.json({ error: e.message }, { status: e.status });
        throw e;
    }

    const formatErrors: ImportReportError[] = parsed.errors.map((e) => ({
        line: e.line,
        source: 'format',
        code: null,
        message: e.message,
    }));

    if (preview) {
        const body: ImportPreview = {
            totalRows: parsed.totalRows,
            validRows: parsed.rows.length,
            sample: parsed.rows.slice(0, 10),
            errors: formatErrors,
        };
        return Response.json(body);
    }

    let inserted = 0;
    const dbErrors: ImportReportError[] = [];

    if (parsed.rows.length > 0) {
        const { data, error } = await supabase.rpc('import_tool_units', { p_rows: parsed.rows });
        if (error) {
            // Ошибка самого вызова (не строки): например, 42501 на execute.
            return Response.json({ error: describeDbError(error) }, { status: 500 });
        }

        const result = data as { inserted: number; errors: { line: number; code: string; message: string }[] };
        inserted = result.inserted;
        for (const e of result.errors) {
            // Текст из базы пользователю не показываем: по SQLSTATE и имени
            // ограничения подбирается свой английский текст (db-errors.ts).
            dbErrors.push({
                line: e.line,
                source: 'database',
                code: e.code,
                message: describeDbError({ code: e.code, message: e.message }),
            });
        }
    }

    const body: ImportReport = {
        totalRows: parsed.totalRows,
        inserted,
        errors: [...formatErrors, ...dbErrors].sort((a, b) => a.line - b.line),
    };
    return Response.json(body);
}
