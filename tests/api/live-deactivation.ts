import type { Ctx } from './types';
import { selectOutcome } from './outcome';

export type LiveStep = { label: string; result: string; ok: boolean };

/**
 * Деактивация "на лету": одна и та же сессия (один и тот же JWT) сначала
 * читает tools, потом сотрудника деактивируют, потом она читает снова.
 * Роль лежит в таблице staff, а не в токене, поэтому доступ пропадает со
 * следующего запроса, хотя токен остаётся валидным до своего exp. При
 * роли в JWT (Custom Access Token Hook) второе чтение прошло бы: токен
 * несёт роль, выпущенную до деактивации. Подробно: docs/book/08-policy-matrix.md.
 */
export async function liveDeactivation(ctx: Ctx): Promise<{ steps: LiveStep[]; passed: boolean }> {
    const { uid, email } = await ctx.make.staffRow('OPERATOR');
    const client = await ctx.signIn(email);
    const steps: LiveStep[] = [];

    const token = async () => (await client.auth.getSession()).data.session?.access_token ?? '';
    const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

    const before = selectOutcome(await client.from('tools').select('id').limit(1));
    const tokenBefore = await token();
    steps.push({ label: 'Active operator reads tools', result: before, ok: before === 'allowed' });

    // Деактивирует service_role (у него есть UPDATE на staff), как сделал бы
    // суперадмин из интерфейса. Токен сотрудника при этом никто не трогает.
    const off = await ctx.admin.from('staff').update({ is_active: false }).eq('user_id', uid);
    if (off.error) throw new Error(`Деактивация: ${off.error.message}`);
    steps.push({ label: 'staff.is_active set to false (token untouched)', result: 'done', ok: true });

    const after = selectOutcome(await client.from('tools').select('id').limit(1));
    const tokenAfter = await token();
    steps.push({ label: 'Same session reads tools again', result: after, ok: after === 'empty' });

    const payload = claims(tokenAfter);
    const secondsLeft = Number(payload.exp) - Math.floor(Date.now() / 1000);
    steps.push({
        label: 'The JWT is the same and still valid',
        result: `unchanged: ${tokenBefore === tokenAfter}, expires in ${secondsLeft} s`,
        ok: tokenBefore === tokenAfter && secondsLeft > 0,
    });
    // В токене нет роли сотрудника: её нечем было бы "устареть". Свойство
    // проверяется по составу claims, а не по значению.
    const roleClaims = Object.keys(payload).filter((k) => /role/i.test(k));
    steps.push({
        label: 'The token carries no staff role (only the Postgres role)',
        result: `role claims: ${roleClaims.join(', ')}; role = ${payload.role}`,
        ok: roleClaims.length === 1 && payload.role === 'authenticated' && !('app_role' in payload),
    });

    return { steps, passed: steps.every((s) => s.ok) };
}
