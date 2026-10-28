// T-1026: istemci için yalnız rehber planı; izin hesabı sunucu modülündedir.
/** İşlem rehberini açma olayı (detay: rehber anahtarı ya da "pick"); T-1120: yüzen kısayol da yayınlar, döngüsel içe aktarma olmasın diye burada. */
export const OP_GUIDE_EVENT = "etkinwms:operation-guide";
export const OP_GUIDES = ['receive', 'putaway', 'issue', 'transfer', 'count'] as const;
export type OpGuide = typeof OP_GUIDES[number];
/**
 * T-1124 (kullanıcı 28 Ekim: "işi yaptırmıyor, sırasıyla doldurulacak yere odaklanmıyor"): her adım gerçek ekrandaki öğeyi gösterir
 * (`target`; virgüllü seçicinin görünen her eşleşmesi ayrı delik) ve klavye odağını oraya verir. `done` görünür olunca adım kendiliğinden
 * ilerler (ekranın kendi durum işareti: `data-guide-done`, sonraki aşamanın kartı vb.); `done` yoksa iş ekrandan ölçülemez, küçük
 * geri / ileri okları kalır. Seçiciler yalnız kararlı çapalara (`data-testid`, `data-guide`, `data-tour`) bağlanır; bekçi
 * `rehber-plan.test.ts` her çapanın ekran kodunda var olduğunu denetler.
 */
export interface GuideInstruction {
    readonly target: string;
    readonly key: string;
    readonly done?: string;
}
/** Alt cam çubuğun ana işlemi (her ekranda aynı çapa). */
const ANA = '[data-tour="main"]';
const TARA = '[data-testid="scan-panel"]';
const MIKTAR = '[data-testid="qty-display"], [data-testid="saha-keypad"]';
export const GUIDE_INSTRUCTIONS: Readonly<Record<OpGuide, readonly GuideInstruction[]>> = {
    receive: [
        { key: 'receive0', target: '[data-testid="receive-pick"], [data-testid="receive-empty"]', done: TARA },
        { key: 'receive1', target: `${TARA}, ${ANA}`, done: '[data-testid="qty-display"]' },
        { key: 'receive2', target: '[data-testid="verify-card"], [data-testid="rack-choice"], [data-testid="rack-auto"]' },
        { key: 'receive3', target: MIKTAR },
        { key: 'receive4', target: ANA, done: '[data-testid="saved-summary"]' },
    ],
    putaway: [
        { key: 'putaway0', target: '[data-guide="putaway-pick"]', done: TARA },
        { key: 'putaway1', target: `[data-testid="task-card"], ${TARA}, ${ANA}`, done: '[data-testid="verify-card"]' },
        { key: 'putaway2', target: '[data-testid="verify-card"]' },
        { key: 'putaway3', target: `[data-testid="fixed-qty"], ${MIKTAR}` },
        { key: 'putaway4', target: ANA, done: '[data-testid="saved-summary"]' },
    ],
    issue: [
        { key: 'source', target: '[data-guide="source"]', done: '[data-guide-done~="source"]' },
        { key: 'item', target: '[data-guide="item"]', done: '[data-guide-done~="item"]' },
        { key: 'quantity', target: '[data-guide="quantity"], [data-guide="reason"]', done: '[data-guide-done~="quantity"]' },
        { key: 'issueSummary', target: `[data-guide="summary"], ${ANA}`, done: '[data-testid="document-state"]' },
        { key: 'issuePost', target: '[data-testid="document-state"]', done: '[data-testid="document-state"][data-status="POSTED"]' },
    ],
    transfer: [
        { key: 'source', target: '[data-guide="source"]', done: '[data-guide-done~="source"]' },
        { key: 'target', target: '[data-guide="target"]', done: '[data-guide-done~="target"]' },
        { key: 'item', target: '[data-guide="item"]', done: '[data-guide-done~="item"]' },
        { key: 'quantity', target: '[data-guide="quantity"], [data-guide="reason"]', done: '[data-guide-done~="quantity"]' },
        { key: 'transferPost', target: `[data-guide="summary"], ${ANA}`, done: '[data-testid="document-state"]' },
    ],
    count: [
        { key: 'count0', target: '[data-testid="field-task"], [data-testid="field-tasks-empty"]', done: '[data-testid="count-card"], [data-testid="count-line"], [data-testid="qty-display"]' },
        { key: 'count1', target: `[data-testid="count-card"], [data-testid="count-line"], ${TARA}`, done: '[data-testid="qty-display"]' },
        { key: 'count2', target: MIKTAR },
        { key: 'count3', target: ANA, done: '[data-testid="count-line"][data-counted="true"], [data-testid="count-saved-diff"]' },
        { key: 'count4', target: `[data-testid="count-line"][data-counted="false"], [data-testid="flow-step"] .sfoot button, ${ANA}` },
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
/**
 * T-1124: rehberin bölümü — bu ekranda rehber çalışır (kart + delik). Dışındaysa rehber kapanmaz, yüzen simgeye katlanır ("Kaldığın
 * yerden devam" rehberin ekranına döner). Belge rehberi kaydedilen belgede (`?id=`) de sürer (son adım: onayla / işle).
 */
export function guideScreen(guide: OpGuide, path: string, query: string): boolean {
    if (currentGuide(path, query) === guide)
        return true;
    if (guide === 'count')
        return path.endsWith('/field/tasks');
    if (guide === 'issue' || guide === 'transfer')
        return path.endsWith('/stock/documents') && new URLSearchParams(query).has('id');
    return false;
}
/**
 * T-1124: adımın bittiğini ekrandan okur (saf; `visible` seçicinin görünür eşleşmesi var mı). Sıradaki adımların bitişi de görünüyorsa
 * (ör. alanlar önceden dolu) ardışık atlanır; adımın hedefi ekranda yoksa ve sonraki bir adımın bitişi görünüyorsa (kullanıcı işi rehberden
 * hızlı yaptı) o adımın sonrasına geçilir. Dönen değer `steps.length` ise rehber bitti.
 */
export function guideAdvance(steps: readonly GuideInstruction[], current: number, visible: (selector: string) => boolean): number {
    let n = current;
    while (n < steps.length && steps[n]!.done !== undefined && visible(steps[n]!.done!))
        n++;
    if (n === current && n < steps.length && !visible(steps[n]!.target)) {
        for (let j = steps.length - 1; j > current; j--) {
            const done = steps[j]!.done;
            if (done !== undefined && visible(done))
                return j + 1;
        }
    }
    return n;
}
