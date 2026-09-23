'use client';

import { Button } from '@/components/ui/button';

/** window.print() - только в браузере, поэтому кнопка клиентская. В печать не попадает (print:hidden). */
export function PrintButton() {
    return (
        <Button type="button" onClick={() => window.print()} className="print:hidden">
            Print
        </Button>
    );
}
