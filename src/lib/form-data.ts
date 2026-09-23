/** Пустой input type=file даёт в FormData File нулевого размера. */
export function fileOrNull(value: FormDataEntryValue | null): File | null {
    return value instanceof File && value.size > 0 ? value : null;
}
