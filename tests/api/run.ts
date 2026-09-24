import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTORS, type Actor } from './types';
import { createContext } from './context';
import { CHECKS } from './matrix';
import { liveDeactivation } from './live-deactivation';
import { consoleTable, markdownReport, mismatches, type Result } from './report';

// Матрица прав через настоящий API: логин каждым пользователем, все проверки
// из matrix.ts, таблица в консоль, docs/policy-matrix-report.md, ненулевой код
// выхода при любом расхождении. Запуск: npm run test:api.

async function main() {
    const { ctx, cleanup } = await createContext();
    const results: Result[] = [];
    let live: Awaited<ReturnType<typeof liveDeactivation>> = { steps: [], passed: false };
    let notes: string[] = [];

    try {
        for (const check of CHECKS) {
            const actual = {} as Record<Actor, string>;
            for (const actor of ACTORS) {
                try {
                    actual[actor] = await check.run(ctx.clients[actor], ctx, actor);
                } catch (e) {
                    // Исключение в самой проверке - тоже расхождение, а не падение прогона.
                    actual[actor] = `exception: ${(e as Error).message}`.slice(0, 80);
                }
            }
            results.push({ check, actual });
        }
        try {
            live = await liveDeactivation(ctx);
        } catch (e) {
            live = { steps: [{ label: 'Scenario crashed', result: (e as Error).message, ok: false }], passed: false };
        }
    } finally {
        notes = await cleanup();
    }

    console.log(consoleTable(results));
    console.log('\nLive deactivation:');
    for (const s of live.steps) console.log(`  ${s.ok ? 'ok ' : '!! '} ${s.label}: ${s.result}`);
    for (const n of notes) console.log(`note: ${n}`);

    const reportPath = resolve(process.cwd(), 'docs/policy-matrix-report.md');
    writeFileSync(reportPath, markdownReport(results, live, notes));
    console.log(`\nReport: ${reportPath}`);

    const bad = mismatches(results);
    if (bad.length > 0 || !live.passed) {
        console.error(`\nFAIL: ${bad.length} mismatch(es)${live.passed ? '' : ', live deactivation scenario failed'}`);
        for (const m of bad) console.error(`  ${m.id} [${m.actor}]: expected ${m.expected}, got ${m.actual}`);
        process.exit(1);
    }
    console.log(`\nOK: ${results.length * ACTORS.length} cells match`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
