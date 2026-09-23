'use client';

import { useState, SubmitEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fileOrNull } from '@/lib/form-data';
import { createCustomer } from '../actions';
import { uploadAndAttachPhotos } from '../upload';
import { CUSTOMER_CATEGORIES, type CustomerCategory } from '../types';
import { CATEGORY_LABELS } from '../constants';

export function CustomerForm({ canSetCategory }: { canSetCategory: boolean }) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdId, setCreatedId] = useState<string | null>(null);

    async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setPending(true);
        setError(null);

        // Шаг 1: карточка (server action, RLS на customers).
        const created = await createCustomer({
            fullName: String(form.get('full_name') ?? ''),
            phone: String(form.get('phone') ?? ''),
            category: canSetCategory
                ? (form.get('category') as CustomerCategory)
                : undefined,
        });

        if (!created.ok) {
            setError(created.error);
            setPending(false);
            return;
        }

        // Шаги 2-3: файлы в Storage из браузера, затем пути в карточку.
        try {
            await uploadAndAttachPhotos(created.data.id, {
                photo: fileOrNull(form.get('photo')),
                document: fileOrNull(form.get('document')),
            });
        } catch (err) {
            setCreatedId(created.data.id);
            setError(
                `Customer created, but the photos weren't saved: ${(err as Error).message}. Add them from the customer's page.`,
            );
            setPending(false);
            return;
        } finally {

        }

        router.push(`/customers/${created.data.id}`);
    }

    return (
        <form onSubmit={onSubmit} className="max-w-md space-y-4">
            <div className="space-y-1">
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" name="full_name" required autoComplete="off" />
            </div>

            <div className="space-y-1">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" required placeholder="067 123 45 67" />
            </div>

            {canSetCategory && (
                <div className="space-y-1">
                    <Label htmlFor="category">Category</Label>
                    <select
                        id="category"
                        name="category"
                        defaultValue="SILVER"
                        className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    >
                        {CUSTOMER_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                        ))}
                    </select>
                </div>
            )}

            <PhotoInput name="photo" label="Customer photo" />
            <PhotoInput name="document" label="Document photo" />

            {error && (
                <p className="text-sm text-red-600">
                    {error}{' '}
                    {createdId && <Link href={`/customers/${createdId}`} className="underline">Open customer</Link>}
                </p>
            )}

            <Button type="submit" disabled={pending || createdId !== null}>
                {pending ? 'Saving...' : 'Register'}
            </Button>
        </form>
    );
}

// capture="environment": на телефоне сразу открывается задняя камера.
// accept без HEIC: iOS в этом случае сам отдаёт JPEG.
export function PhotoInput({ name, label }: { name: string; label: string }) {
    return (
        <div className="space-y-1">
            <Label htmlFor={name}>{label}</Label>
            <Input
                id={name}
                name={name}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
            />
        </div>
    );
}