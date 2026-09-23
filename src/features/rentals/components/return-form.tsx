'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { returnRentalItems } from '../actions';
import { uploadRentalPhoto } from '../upload';
import type { getRentalWithDetails } from '../queries';

// import type - серверный запрос в клиентский бандл не попадает, нужен
// только тип строки позиции.
type Item = NonNullable<Awaited<ReturnType<typeof getRentalWithDetails>>>['items'][number];

/** Позиции, ещё не возвращённые (returned_at is null) - отметить, снять
 *  фото каждой отмеченной, подтвердить. Возврат без фото отклонит база
 *  (rental_items_return_requires_photo), но сообщение понятнее показать
 *  до отправки, а не после 23514. */
export function ReturnForm({ rentalId, items }: { rentalId: string; items: Item[] }) {
    const router = useRouter();
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [photos, setPhotos] = useState<Record<string, File | null>>({});
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const openItems = items.filter((i) => i.returned_at === null);
    if (openItems.length === 0) return null;

    const selectedIds = openItems.filter((i) => checked[i.id]).map((i) => i.id);
    const missingPhoto = selectedIds.some((id) => !photos[id]);

    async function handleSubmit() {
        if (selectedIds.length === 0) {
            setError('Select at least one item to return.');
            return;
        }
        if (missingPhoto) {
            setError('Add a photo for every item you are returning.');
            return;
        }
        setPending(true);
        setError(null);

        try {
            const uploaded = await Promise.all(
                selectedIds.map(async (id) => ({
                    itemId: id,
                    photoPath: await uploadRentalPhoto(rentalId, id, 'return', photos[id] as File),
                })),
            );
            const result = await returnRentalItems(uploaded);
            if (!result.ok) {
                setError(result.error);
                setPending(false);
                return;
            }
        } catch (err) {
            setError((err as Error).message);
            setPending(false);
            return;
        }

        router.refresh();
    }

    return (
        <div className="space-y-4 rounded-md border p-4">
            <h2 className="font-medium">Return units</h2>
            <div className="space-y-3">
                {openItems.map((item) => (
                    <div key={item.id} className="flex flex-col gap-2 border-b pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                className="size-4"
                                checked={checked[item.id] ?? false}
                                onChange={(e) => setChecked((c) => ({ ...c, [item.id]: e.target.checked }))}
                            />
                            <span>
                                {item.tool_units?.inventory_number}
                                {item.tool_units?.tools && (
                                    <span className="text-muted-foreground"> - {item.tool_units.tools.name}</span>
                                )}
                            </span>
                        </label>
                        {checked[item.id] && (
                            <Input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                capture="environment"
                                className="sm:max-w-xs"
                                onChange={(e) =>
                                    setPhotos((p) => ({ ...p, [item.id]: e.target.files?.[0] ?? null }))
                                }
                            />
                        )}
                    </div>
                ))}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="button" size="lg" className="w-full" disabled={pending} onClick={handleSubmit}>
                {pending ? 'Returning...' : 'Confirm return'}
            </Button>
        </div>
    );
}
