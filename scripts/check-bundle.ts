import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Проверка, что секреты не попали в клиентский бандл. Запуск: npm run check:bundle.
//   1. Ни одна переменная с секретом не называется NEXT_PUBLIC_*: Next.js
//      встраивает такие переменные в клиентский код при сборке.
//   2. next build.
//   3. В .next/static (это и есть то, что уходит в браузер) нет значения
//      secret key, значения SEED_PASSWORD и строки service_role.
// Найдено - ненулевой код выхода. Значения секретов в вывод не попадают.

const failures: string[] = [];
const secretKey = process.env.SUPABASE_SECRET_KEY;
const seedPassword = process.env.SEED_PASSWORD;
if (!secretKey) {
    console.error('Нужна SUPABASE_SECRET_KEY в .env.local: без неё искать в бандле нечего.');
    process.exit(1);
}

// --- 1. Имена переменных ---------------------------------------------------
const SECRET_NAME = /SECRET|SERVICE|PASSWORD|PRIVATE|DB_URL/i;
const names = new Set(Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_')));
for (const file of ['.env.example', '.env.local']) {
    if (!existsSync(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)) {
        if (match[1].startsWith('NEXT_PUBLIC_')) names.add(match[1]);
    }
}
for (const name of names) {
    const value = process.env[name];
    if (SECRET_NAME.test(name)) failures.push(`переменная ${name} публична (NEXT_PUBLIC_) и похожа на секрет по имени`);
    if (value && (value === secretKey || value === seedPassword)) {
        failures.push(`переменная ${name} публична (NEXT_PUBLIC_), а её значение - секрет`);
    }
}
console.log(`Публичные переменные: ${[...names].sort().join(', ') || '(нет)'}`);

// --- 2. Сборка -------------------------------------------------------------
const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) {
    console.error('FAIL: next build не прошёл');
    process.exit(1);
}

// --- 3. Поиск в .next/static ----------------------------------------------
function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const path = join(dir, e.name);
        return e.isDirectory() ? walk(path) : [path];
    });
}

const needles: { label: string; value: string }[] = [
    { label: 'значение SUPABASE_SECRET_KEY', value: secretKey },
    { label: 'строка service_role', value: 'service_role' },
];
if (seedPassword) needles.push({ label: 'значение SEED_PASSWORD', value: seedPassword });

const staticFiles = walk('.next/static');
for (const file of staticFiles) {
    const text = readFileSync(file, 'utf8');
    for (const n of needles) {
        if (text.includes(n.value)) failures.push(`${n.label} найдено в ${file}`);
    }
}
console.log(`Просмотрено файлов в .next/static: ${staticFiles.length}`);

if (failures.length > 0) {
    console.error('\nFAIL:');
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}
console.log('\nOK: секретов в клиентском бандле нет');
