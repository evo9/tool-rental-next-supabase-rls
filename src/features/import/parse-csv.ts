import Papa from 'papaparse';
import { z } from 'zod';

// Разбор и проверка формата CSV для импорта единиц. Чистые функции без
// обращения к Supabase: то, что здесь признано неверным, в базу не идёт и
// попадает в отчёт с номером строки. Функция import_tool_units проверяет то
// же самое ещё раз (тип, ограничения таблиц) - приложение не единственный
// возможный её клиент. Подробно: docs/book/07-dashboard-import-qr.md.

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_ROWS = 1000;

export type ImportRow = {
    /** Номер строки в файле: заголовок - строка 1, как в Excel. */
    line: number;
    tool_name: string;
    daily_rate: number;
    deposit: number;
    inventory_number: string;
    status: 'AVAILABLE' | 'UNAVAILABLE';
};

export type FormatError = { line: number; message: string };

/** Файл непригоден целиком (нет колонок, слишком большой) - HTTP-ответ с этим статусом. */
export class CsvFileError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/**
 * Excel в русской и украинской локали сохраняет "CSV UTF-8" как UTF-8 с
 * BOM, а просто "CSV" - в Windows-1251. fatal: true заставляет TextDecoder
 * бросить ошибку на невалидном UTF-8, тогда файл читается как Windows-1251,
 * а не превращается в набор нечитаемых символов. BOM TextDecoder по умолчанию
 * снимает сам, replace ниже - страховка.
 */
export function decodeCsv(buffer: ArrayBuffer): string {
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        text = new TextDecoder('windows-1251').decode(buffer);
    }
    return text.replace(/^﻿/, '');
}

/**
 * Разделитель определяется по строке заголовка, а не по всему файлу: в
 * заголовке нет чисел, а в теле запятая может быть десятичной ("250,00"),
 * и подсчёт по всему файлу мог бы ошибиться. Побеждает более частый из
 * `;` и `,`, при равенстве - запятая.
 */
export function detectDelimiter(text: string): ';' | ',' {
    const header = text.split(/\r?\n/, 1)[0] ?? '';
    const semicolons = header.split(';').length - 1;
    const commas = header.split(',').length - 1;
    return semicolons > commas ? ';' : ',';
}

// Число до 8 знаков перед точкой и до 2 после - numeric(10, 2) в tools.
// Запятая допускается как десятичный разделитель: так пишет Excel в этих
// локалях. Знака нет: тариф и залог не бывают отрицательными.
const money = z
    .string()
    .trim()
    .min(1, 'is required')
    .transform((v) => v.replace(',', '.'))
    .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'must be a non-negative number with up to 2 decimals'))
    .transform(Number);

const rowSchema = z.object({
    tool_name: z.string().trim().min(1, 'is required'),
    daily_rate: money,
    deposit: money,
    inventory_number: z.string().trim().min(1, 'is required'),
    // Пустая ячейка - AVAILABLE. Регистр не важен. RENTED и WRITTEN_OFF
    // сюда не попадают: единица не создаётся выданной или списанной.
    status: z
        .string()
        .trim()
        .transform((v) => (v === '' ? 'AVAILABLE' : v.toUpperCase()))
        .pipe(z.enum(['AVAILABLE', 'UNAVAILABLE'], { error: 'must be AVAILABLE or UNAVAILABLE' })),
});

const REQUIRED_COLUMNS = ['tool_name', 'daily_rate', 'deposit', 'inventory_number'] as const;

export function parseImportCsv(buffer: ArrayBuffer): { rows: ImportRow[]; errors: FormatError[]; totalRows: number } {
    const text = decodeCsv(buffer);
    const parsed = Papa.parse<string[]>(text, { delimiter: detectDelimiter(text) });

    // Нумерация строк - по позиции в разобранном файле, что совпадает с номером
    // строки в Excel, пока в ячейках нет переводов строки внутри кавычек.
    const [headerRow, ...dataRows] = parsed.data;
    if (!headerRow) throw new CsvFileError('The file is empty.', 400);

    const header = headerRow.map((h) => h.trim().toLowerCase());
    const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length > 0) {
        throw new CsvFileError(`Missing column(s): ${missing.join(', ')}.`, 400);
    }

    const rows: ImportRow[] = [];
    const errors: FormatError[] = [];
    let totalRows = 0;

    dataRows.forEach((cells, index) => {
        // Пустые строки (в том числе последний перевод строки) пропускаются молча.
        if (cells.every((c) => c.trim() === '')) return;

        totalRows += 1;
        const line = index + 2;
        const record: Record<string, string> = {};
        header.forEach((name, i) => {
            record[name] = cells[i] ?? '';
        });

        const result = rowSchema.safeParse({ ...record, status: record.status ?? '' });
        if (!result.success) {
            const message = result.error.issues.map((i) => `${String(i.path[0])} ${i.message}`).join('; ');
            errors.push({ line, message });
            return;
        }
        rows.push({ line, ...result.data });
    });

    if (totalRows > MAX_ROWS) {
        throw new CsvFileError(`The file has more than ${MAX_ROWS} rows. Split it into several files.`, 413);
    }

    return { rows, errors, totalRows };
}
