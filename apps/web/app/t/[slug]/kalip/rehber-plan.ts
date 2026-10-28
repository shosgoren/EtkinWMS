// T-1026: istemci için yalnız rehber planı; izin hesabı sunucu modülündedir.
/** İşlem rehberini açma olayı (detay: rehber anahtarı ya da "pick"); T-1120: yüzen kısayol da yayınlar, döngüsel içe aktarma olmasın diye burada. */
export const OP_GUIDE_EVENT = "etkinwms:operation-guide";
export const OP_GUIDES = ['receive', 'putaway', 'issue', 'transfer', 'count'] as const;
export type OpGuide = typeof OP_GUIDES[number];
export interface GuideInstruction {
    readonly target: string;
    readonly key: string;
}
export const GUIDE_INSTRUCTIONS: Readonly<Record<OpGuide, readonly GuideInstruction[]>> = {
    receive: [
        { key: 'receive0', target: '[data-testid="scan-panel"]' },
        { key: 'receive1', target: '[data-testid="verified-item"], [data-testid="verify-card"], .job' },
        { key: 'receive2', target: '[data-testid="rack-choice"], [data-testid="scan-panel"]' },
        { key: 'receive3', target: '[data-testid="qty-display"], .qdisp, [data-testid="flow-primary"]' },
        { key: 'receive4', target: '[data-testid="saved-summary"], [data-testid="flow-primary"]' },
    ],
    putaway: [
        { key: 'putaway0', target: '[data-testid="task-card"], [data-testid="scan-panel"]' },
        { key: 'putaway1', target: '[data-testid="scan-panel"]' },
        { key: 'putaway2', target: '[data-testid="verified-item"], [data-testid="verify-card"]' },
        { key: 'putaway3', target: '.qdisp, [data-testid="flow-primary"]' },
        { key: 'putaway4', target: '[data-testid="saved-summary"], [data-testid="flow-primary"]' },
    ],
    issue: [
        { key: 'source', target: '[data-guide="source"]' },
        { key: 'item', target: '[data-guide="item"]' },
        { key: 'quantity', target: '[data-guide="quantity"]' },
        { key: 'issueSummary', target: '[data-guide="summary"], [data-guide="submit"]' },
        { key: 'issuePost', target: '[data-testid="document-state"]' },
    ],
    transfer: [
        { key: 'source', target: '[data-guide="source"]' },
        { key: 'target', target: '[data-guide="target"]' },
        { key: 'item', target: '[data-guide="item"]' },
        { key: 'quantity', target: '[data-guide="quantity"]' },
        { key: 'transferPost', target: '[data-guide="summary"], [data-guide="submit"], [data-testid="document-state"]' },
    ],
    count: [
        { key: 'count0', target: '[data-testid="count-card"], [data-testid="task-list"]' },
        { key: 'count1', target: '[data-testid="scan-panel"]' },
        { key: 'count2', target: '[data-testid="count-qty-decimal"], [data-testid="count-qty"], .qdisp' },
        { key: 'count3', target: '[data-testid="flow-primary"]' },
        { key: 'count4', target: '[data-testid="count-line"], [data-testid="flow-primary"]' },
    ],
};
export function guideHref(base: string, guide: OpGuide): string {
    return `${base}${({ receive: '/field/receive', putaway: '/field/putaway', issue: '/stock/documents?new=STOCK_OUT', transfer: '/stock/documents?new=TRANSFER', count: '/field/tasks?kind=COUNT' } as const)[guide]}`;
}
export function currentGuide(path: string, query: string): OpGuide | null {
    if (path.endsWith('/field/receive'))
        return 'receive';
    if (path.endsWith('/field/putaway'))
        return 'putaway';
    if (path.endsWith('/field/count') || (path.endsWith('/field/tasks') && new URLSearchParams(query).get('kind') === 'COUNT'))
        return 'count';
    if (path.endsWith('/stock/documents')) {
        const kind = new URLSearchParams(query).get('new');
        if (kind === 'STOCK_OUT')
            return 'issue';
        if (kind === 'TRANSFER')
            return 'transfer';
    }
    return null;
}
