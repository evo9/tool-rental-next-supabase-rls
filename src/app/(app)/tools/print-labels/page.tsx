import type { Metadata } from 'next';
import Link from 'next/link';
import { listUnitsForLabels } from '@/features/tools/queries';
import { unitQrSvg } from '@/features/tools/qr';
import { PrintButton } from '@/features/tools/components/print-button';

export const metadata: Metadata = { title: 'Print labels' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Столько наклеек помещается в один запрос: 21 на лист A4, десять листов.
const MAX_LABELS = 200;

/**
 * /tools/print-labels?ids=<uuid>,<uuid> или ?tool=<uuid> (все единицы модели).
 * Единицы читаются сессионным клиентом: чужие или несуществующие id RLS
 * просто не вернёт. Страница печатная: навигация скрыта правилами print:
 * в layout, лист A4 - сетка 3 x 7 наклеек 63 x 38 мм.
 */
export default async function PrintLabelsPage({
    searchParams,
}: {
    searchParams: Promise<{ ids?: string; tool?: string }>;
}) {
    const { ids, tool } = await searchParams;

    const idList = ids
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => UUID.test(s))
        .slice(0, MAX_LABELS);
    const toolId = tool && UUID.test(tool) ? tool : undefined;

    const units = idList?.length || toolId ? await listUnitsForLabels({ ids: idList?.length ? idList : undefined, toolId }) : [];
    const labels = await Promise.all(units.map(async (u) => ({ unit: u, qr: await unitQrSvg(u.id) })));

    return (
        <div className="space-y-4">
            {/* Поля листа задаются здесь, а не глобально: правило действует, пока открыта эта страница. */}
            <style>{'@page { size: A4; margin: 8mm; }'}</style>

            <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                <div>
                    <h1 className="text-xl font-semibold">Print labels</h1>
                    <p className="text-sm text-muted-foreground">{labels.length} label(s), A4, 3 columns.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Link href="/tools" className="text-sm text-muted-foreground hover:underline">
                        Back to tools
                    </Link>
                    {labels.length > 0 && <PrintButton />}
                </div>
            </div>

            {labels.length === 0 ? (
                <p className="text-sm text-muted-foreground print:hidden">
                    No units to print. Select units on a tool page.
                </p>
            ) : (
                <div className="grid grid-cols-3">
                    {labels.map(({ unit, qr }) => (
                        <div
                            key={unit.id}
                            className="flex h-[38mm] break-inside-avoid items-center gap-2 overflow-hidden border border-dashed border-zinc-300 p-2 print:border-zinc-200"
                        >
                            <div
                                className="h-[28mm] w-[28mm] shrink-0 [&>svg]:h-full [&>svg]:w-full"
                                // Разметку целиком строит qrcode из адреса и uuid, см. qr.ts.
                                dangerouslySetInnerHTML={{ __html: qr }}
                            />
                            <div className="min-w-0">
                                <p className="break-words text-lg font-bold leading-tight">{unit.inventory_number}</p>
                                <p className="line-clamp-3 break-words text-xs leading-tight">{unit.tools?.name}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
