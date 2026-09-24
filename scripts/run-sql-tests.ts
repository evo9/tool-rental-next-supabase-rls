import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

// Прогон всех SQL-тестов из tests/ по порядку, остановка на первом провале.
// Запуск: npm run test:sql (DB_URL берётся из .env.local, как у seed:staff).
//
// Порядок - по имени файла без папки: 02_roles, 03_customers, 04_rentals,
// 05_calc, 05_pricing, 06_audit, 07_dashboard_import. Так же, как в главах
// книги. Не тесты, а вспомогательные файлы лежат в tests/manual (ломают и
// чинят политику намеренно), tests/fixtures и tests/api - они пропускаются.
//
// Основной способ - psql с ON_ERROR_STOP=1. Если psql не установлен,
// запасной - supabase db query --linked -f (тот же результат "прошёл или
// упал", но без построчных NOTICE).

const SKIP_DIRS = new Set(['manual', 'fixtures', 'api']);

function collect(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : collect(path);
        return entry.name.endsWith('.sql') ? [path] : [];
    });
}

// DB_URL нужна только psql. Запасной путь ходит в привязанный проект через
// supabase CLI (supabase link) и строки подключения не требует.
const dbUrl = process.env.DB_URL;
const usePsql = spawnSync('psql', ['--version'], { stdio: 'ignore' }).status === 0 && Boolean(dbUrl);
console.log(
    usePsql
        ? 'Запуск через psql'
        : 'psql или DB_URL недоступны, запуск через supabase db query --linked (без NOTICE)',
);

const files = collect('tests').sort((a, b) => basename(a).localeCompare(basename(b)));
const verbose = process.argv.includes('--verbose');

for (const file of files) {
    const result = usePsql
        ? spawnSync('psql', [dbUrl as string, '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8' })
        : spawnSync('npx', ['supabase', 'db', 'query', '--linked', '-f', file], { encoding: 'utf8' });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.status !== 0) {
        console.error(`FAIL  ${file}\n`);
        console.error(output);
        process.exit(1);
    }
    const checks = (output.match(/NOTICE:\s+ok/g) ?? []).length;
    console.log(`ok    ${file}${usePsql ? `  (${checks} checks)` : ''}`);
    if (verbose) console.log(output);
}

console.log(`\nOK: ${files.length} files`);
