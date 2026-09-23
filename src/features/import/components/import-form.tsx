'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ImportPreview, ImportReport, ImportReportError } from '../types';

const ENDPOINT = '/api/import/tool-units';

/**
 * Два шага через один эндпоинт: mode=preview только разбирает файл на
 * сервере (в базу не ходит), mode=import вставляет. Разбор один и тот же,
 * поэтому предпросмотр не может разойтись с тем, что потом вставится.
 */
export function ImportForm() {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const [report, setReport] = useState<ImportReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    async function send(mode: 'preview' | 'import', f: File) {
        const body = new FormData();
        body.set('file', f);
        const response = await fetch(`${ENDPOINT}?mode=${mode}`, { method: 'POST', body });
        const json = await response.json().catch(() => null);
        if (!response.ok) throw new Error(json?.error ?? 'Something went wrong. Please try again.');
        return json;
    }

    async function handleFile(f: File | null) {
        setFile(f);
        setPreview(null);
        setReport(null);
        setError(null);
        if (!f) return;

        setPending(true);
        try {
            setPreview(await send('preview', f));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setPending(false);
        }
    }

    async function handleImport() {
        if (!file) return;
        setPending(true);
        setError(null);
        try {
            setReport(await send('import', file));
            setPreview(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    className="max-w-md"
                />
                <p className="text-sm text-muted-foreground">
                    Columns: tool_name, daily_rate, deposit, inventory_number, status (optional: AVAILABLE or
                    UNAVAILABLE). Separator ; or , is detected automatically.{' '}
                    <a href="/templates/tool-units-import.csv" className="underline" download>
                        Download template
                    </a>
                </p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            {preview && (
                <section className="space-y-3">
                    <h2 className="font-medium">Preview</h2>
                    <p className="text-sm">
                        {preview.totalRows} row(s) in the file, {preview.validRows} ready to import
                        {preview.errors.length > 0 && `, ${preview.errors.length} with format errors`}.
                    </p>
                    {preview.sample.length > 0 && (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Line</TableHead>
                                    <TableHead>Tool</TableHead>
                                    <TableHead className="text-right">Daily rate</TableHead>
                                    <TableHead className="text-right">Deposit</TableHead>
                                    <TableHead>Inventory No.</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {preview.sample.map((r) => (
                                    <TableRow key={r.line}>
                                        <TableCell>{r.line}</TableCell>
                                        <TableCell>{r.tool_name}</TableCell>
                                        <TableCell className="text-right">{r.daily_rate}</TableCell>
                                        <TableCell className="text-right">{r.deposit}</TableCell>
                                        <TableCell>{r.inventory_number}</TableCell>
                                        <TableCell>{r.status}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    {preview.validRows > preview.sample.length && (
                        <p className="text-sm text-muted-foreground">
                            Showing the first {preview.sample.length} valid rows.
                        </p>
                    )}
                    <ErrorsTable errors={preview.errors} title="Rows that will be skipped" />
                    <Button type="button" disabled={pending || preview.validRows === 0} onClick={handleImport}>
                        {pending ? 'Importing...' : `Import ${preview.validRows} row(s)`}
                    </Button>
                </section>
            )}

            {report && (
                <section className="space-y-3">
                    <h2 className="font-medium">Import report</h2>
                    <p className="text-sm">
                        Inserted {report.inserted} of {report.totalRows} row(s)
                        {report.errors.length > 0 ? `, ${report.errors.length} not imported.` : '.'}{' '}
                        <Link href="/tools" className="underline">
                            Go to tools
                        </Link>
                    </p>
                    <ErrorsTable errors={report.errors} title="Errors" />
                </section>
            )}
        </div>
    );
}

function ErrorsTable({ errors, title }: { errors: ImportReportError[]; title: string }) {
    if (errors.length === 0) return null;

    return (
        <div className="space-y-1">
            <h3 className="text-sm font-medium">{title}</h3>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Line</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Reason</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {errors.map((e) => (
                        <TableRow key={`${e.line}-${e.source}`}>
                            <TableCell>{e.line}</TableCell>
                            <TableCell>{e.source === 'format' ? 'File format' : 'Database'}</TableCell>
                            <TableCell>{e.code ?? '-'}</TableCell>
                            <TableCell>{e.message}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
