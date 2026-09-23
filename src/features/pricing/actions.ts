'use server';

import { createClient } from '@/lib/supabase/server';
import { describeDbError } from '@/lib/db-errors';
import type { ActionResult } from './types';
import type { CustomerCategory } from '@/features/customers/types';

/** Грант на update(grace_hours) выдан любому активному сотруднику
 *  (глава 05, тот же приём, что у tools) - роль решает политика
 *  "manager+ can update grace periods". OPERATOR получает count === 0,
 *  не ошибку: строка есть, RLS её не пропустила. */
export async function updateGraceHours(
    category: CustomerCategory,
    graceHours: number,
): Promise<ActionResult<null>> {
    const supabase = await createClient();
    const { error, count } = await supabase
        .from('category_grace_periods')
        .update({ grace_hours: graceHours }, { count: 'exact' })
        .eq('category', category);

    if (error) return { ok: false, error: describeDbError(error) };
    if (count === 0) return { ok: false, error: "You don't have permission to change this." };
    return { ok: true, data: null };
}
