'use client';

import { useState, SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { fileOrNull } from '@/lib/form-data';
import { uploadAndAttachPhotos } from '../upload';
import { PhotoInput } from './customer-form';

/** Добавить или заменить фото. Старый файл остаётся в бакете как история. */
export function AttachPhotosForm({ customerId }: { customerId: string }) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        const formEl = e.currentTarget;
        const form = new FormData(formEl);
        setPending(true);
        setError(null);
        try {
            await uploadAndAttachPhotos(customerId, {
                photo: fileOrNull(form.get('photo')),
                document: fileOrNull(form.get('document')),
            });
            formEl.reset();
            // Перерисовать серверный компонент: новые пути, новые signed URL.
            router.refresh();
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPending(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="max-w-md space-y-4">
            <PhotoInput name="photo" label="Customer photo" />
            <PhotoInput name="document" label="Document photo" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" variant="outline" disabled={pending}>
                {pending ? 'Uploading...' : 'Upload photos'}
            </Button>
        </form>
    );
}