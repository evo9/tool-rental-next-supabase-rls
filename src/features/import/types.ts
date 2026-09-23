/** Строка отчёта об ошибке. source: format - отсеяна до базы, database - ответ import_tool_units. */
export type ImportReportError = {
    line: number;
    source: 'format' | 'database';
    /** SQLSTATE для database, для format - null. */
    code: string | null;
    message: string;
};

export type ImportPreview = {
    totalRows: number;
    validRows: number;
    sample: { line: number; tool_name: string; daily_rate: number; deposit: number; inventory_number: string; status: string }[];
    errors: ImportReportError[];
};

export type ImportReport = {
    totalRows: number;
    inserted: number;
    errors: ImportReportError[];
};
