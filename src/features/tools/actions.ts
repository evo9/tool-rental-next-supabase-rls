'use server';

import { createClient } from '@/lib/supabase/server';
import { describeDbError } from '@/lib/db-errors';
import type { ActionResult } from '@/features/rentals/types';

// Обе функции работают сессионным клиентом: право менять единицы решают
// политики "manager+ can insert/update tool units" (этап 4, этап 7), а
// допустимость перехода статуса - триггер tool_units_guard_status.
// Проверка роли в интерфейсе (кнопки видит MANAGER+) - только UX.

/** RENTED здесь нет намеренно: его ставит только выдача (rental_items_sync_unit). */
const SETTABLE_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'WRITTEN_OFF'] as const;
type SettableStatus = (typeof SETTABLE_STATUSES)[number];

const NEW_UNIT_STATUSES = ['AVAILABLE', 'UNAVAILABLE'] as const;
type NewUnitStatus = (typeof NEW_UNIT_STATUSES)[number];

/**
 * Новая единица. WITH CHECK политики INSERT пускает только AVAILABLE и
 * UNAVAILABLE (миграция этапа 7); RENTED и WRITTEN_OFF отклонит база
 * кодом 42501, даже если обойти список ниже.
 * 23505 - инвентарный номер уже занят (tool_units_inventory_number_key).
 */
export async function addUnit(input: {
    toolId: string;
    inventoryNumber: string;
    status: NewUnitStatus;
    note: string;
}): Promise<ActionResult<{ id: string }>> {
    const inventoryNumber = input.inventoryNumber.trim();
    if (!inventoryNumber) return { ok: false, error: 'Enter an inventory number.' };
    if (!NEW_UNIT_STATUSES.includes(input.status)) {
        return { ok: false, error: 'A new unit can only be Available or Unavailable.' };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
        .from('tool_units')
        .insert({
            tool_id: input.toolId,
            inventory_number: inventoryNumber,
            status: input.status,
            note: input.note.trim() || null,
        })
        .select('id')
        .single();

    if (error) return { ok: false, error: describeDbError(error) };
    return { ok: true, data: { id: data.id } };
}

/**
 * Смена статуса. UPDATE-грант на status выдан всем authenticated, роль
 * решает политика: OPERATOR получает count === 0, не ошибку (строка есть,
 * USING её не пропустил). Переход RENTED <-> остальные и выход из
 * WRITTEN_OFF отклоняет триггер (P0001).
 */
export async function setUnitStatus(unitId: string, status: SettableStatus): Promise<ActionResult<null>> {
    if (!SETTABLE_STATUSES.includes(status)) return { ok: false, error: 'This status cannot be set manually.' };

    const supabase = await createClient();
    const { error, count } = await supabase
        .from('tool_units')
        .update({ status }, { count: 'exact' })
        .eq('id', unitId);

    if (error) return { ok: false, error: describeDbError(error) };
    if (count === 0) return { ok: false, error: "Unit not found, or you don't have permission." };
    return { ok: true, data: null };
}
