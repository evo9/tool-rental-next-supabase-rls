'use server';

import { createClient } from '@/lib/supabase/server';
import { describeDbError } from '@/lib/db-errors';
import { listCustomers } from '@/features/customers/queries';
import type { ActionResult } from './types';

export async function searchCustomers(q: string) {
    return listCustomers(q);
}

export async function issueRental(input: {
    customerId: string;
    plannedReturnAt: string;
    unitIds: string[];
}): Promise<ActionResult<{ rentalId: string; items: { rentalItemId: string; toolUnitId: string }[] }>> {
    if (input.unitIds.length === 0) return { ok: false, error: 'Select at least one unit.' };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc('issue_rental', {
        p_customer_id: input.customerId,
        p_planned_return_at: input.plannedReturnAt,
        p_unit_ids: input.unitIds,
    });

    if (error) return { ok: false, error: describeDbError(error) };
    return {
        ok: true,
        data: {
            rentalId: data[0].rental_id,
            items: data.map((row) => ({ rentalItemId: row.rental_item_id, toolUnitId: row.tool_unit_id })),
        },
    };
}

/** Записывает путь к фото выдачи. INSERT в issue_photo_path не грантован -
 *  фото прикладывается отдельным UPDATE после того, как позиция уже создана
 *  (тот же порядок, что у фото клиента на этапе 3). */
export async function attachIssuePhoto(rentalItemId: string, photoPath: string): Promise<ActionResult<null>> {
    const supabase = await createClient();
    const { error, count } = await supabase
        .from('rental_items')
        .update({ issue_photo_path: photoPath }, { count: 'exact' })
        .eq('id', rentalItemId);

    if (error) return { ok: false, error: describeDbError(error) };
    // USING не пропустил строку: RLS не даёт ошибку, только 0 строк.
    if (count === 0) return { ok: false, error: "Item not found, or you don't have permission." };
    return { ok: true, data: null };
}

export async function returnRentalItems(
    items: { itemId: string; photoPath: string }[],
): Promise<ActionResult<null>> {
    if (items.length === 0) return { ok: false, error: 'Select at least one item to return.' };

    const supabase = await createClient();
    const { error } = await supabase.rpc('return_rental_items', {
        p_items: items.map((i) => ({ item_id: i.itemId, photo_path: i.photoPath })),
    });

    if (error) return { ok: false, error: describeDbError(error) };
    return { ok: true, data: null };
}
