// Применённые миграции бросают тексты ошибок на русском (раздел "Стандарт
// комментирования SQL" в CLAUDE.md - язык самой базы). Миграции не
// переписываются, поэтому интерфейс различает ошибку по SQLSTATE (`code`)
// и, где он есть, по имени ограничения из `message`/`details`, и показывает
// свой английский текст, а не текст из базы.

export type DbError = {
    code?: string;
    message: string;
    details?: string | null;
};

function constraintName(error: DbError): string | null {
    const haystack = `${error.message} ${error.details ?? ''}`;
    return haystack.match(/constraint "([^"]+)"/)?.[1] ?? null;
}

type Rule = {
    code: string;
    matches: (error: DbError) => boolean;
    text: string;
};

const RULES: Rule[] = [
    {
        code: '23505',
        matches: (e) => constraintName(e) === 'customers_phone_key',
        text: 'A customer with this phone number is already registered.',
    },
    {
        code: '23514',
        matches: (e) => constraintName(e) === 'customers_full_name_not_blank',
        text: 'Enter a full name.',
    },
    {
        code: '23514',
        matches: (e) => constraintName(e) === 'customers_phone_e164',
        text: 'Enter a valid phone number.',
    },
    {
        code: '23514',
        matches: (e) =>
            constraintName(e) === 'customers_photo_path_own_folder' ||
            constraintName(e) === 'customers_document_photo_path_own_folder',
        text: "This photo doesn't belong to this customer.",
    },
    {
        // Триггер customers_guard_category (миграция этапа 3) бросает 42501
        // с этим текстом на русском - отличаем его от обычного отказа RLS
        // по содержимому сообщения, имени ограничения тут нет.
        code: '42501',
        matches: (e) => e.message.includes('requires MANAGER role'),
        text: 'Only a manager or above can change the customer category.',
    },
];

const GENERIC_BY_CODE: Record<string, string> = {
    '42501': "You don't have permission to do this.",
    '23514': "This data didn't pass validation.",
    '23505': 'This value is already in use.',
};

const FALLBACK_TEXT = 'Something went wrong. Please try again.';

/** Переводит ошибку Postgres/PostgREST в текст для пользователя. */
export function describeDbError(error: DbError): string {
    const rule = RULES.find((r) => r.code === error.code && r.matches(error));
    if (rule) return rule.text;

    const generic = error.code ? GENERIC_BY_CODE[error.code] : undefined;
    if (generic) return generic;

    console.error('Unhandled database error:', error);
    return FALLBACK_TEXT;
}
