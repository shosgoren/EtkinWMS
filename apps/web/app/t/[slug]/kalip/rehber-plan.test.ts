import { guideAccess } from './rehber-access.ts';
import { describe, expect, it } from 'vitest';
import { currentGuide, GUIDE_INSTRUCTIONS, OP_GUIDES, guideHref } from './rehber-plan.ts';
import { filterJourney, STEP_KEYS, type JourneyData } from '../yolculuk/steps.ts';
const member = (roles: string[], screens: string[] | null = null, grants: string[] = []) => ({ roles, screens, grants });
describe('işlem rehberleri: mevcut yetkiler, eylem izni değildir', () => {
    it('hesap sahibi beş işlemi ve kurulumun tümünü seçebilir', () => { expect(guideAccess(member(['TENANT_ADMIN']))).toEqual({ setup: STEP_KEYS, operations: OP_GUIDES }); });
    it('depo yöneticisine ekip/ERP/raf yönetimi önerilmez', () => { const a = guideAccess(member(['WAREHOUSE_MANAGER'])); expect(a.setup).not.toContain('people'); expect(a.setup).not.toContain('cards'); expect(a.setup).not.toContain('shelves'); expect(a.operations).toEqual(OP_GUIDES); });
    it('saha ve sayım ayrılır; özel ekran kısıtı ek izinle açılmaz', () => {
        expect(guideAccess(member(['PICKER'], ['receive'])).operations).toEqual(['receive', 'putaway']);
        expect(guideAccess(member(['COUNTER'], ['count'])).operations).toEqual(['count']);
        expect(guideAccess(member(['READ_ONLY'])).operations).toEqual([]);
        expect(guideAccess(member(['PICKER'], ['count'], ['document.create'])).operations).toEqual(['count']);
    });
    it('her işlem en çok beş uygulanabilir hedef taşır; geçerli rota bağımsız seçilir', () => {
        for (const g of OP_GUIDES) {
            expect(GUIDE_INSTRUCTIONS[g]).toHaveLength(5);
            expect(GUIDE_INSTRUCTIONS[g].every(s => s.key.length > 0 && s.target.length > 0)).toBe(true);
            expect(guideHref('/t/a', g)).toMatch(/^\/t\/a\//);
        }
        expect(currentGuide('/t/a/stock/documents', 'new=TRANSFER')).toBe('transfer');
        expect(currentGuide('/t/a/stock/documents', 'new=STOCK_OUT')).toBe('issue');
        expect(currentGuide('/t/a/field/count', 'task=123')).toBe('count');
        expect(currentGuide('/t/a/items', '')).toBeNull();
    });
    it('görünmeyen kurulum adımı sonraki olmaz ve halkada sayılmaz', () => {
        const j: JourneyData = { makesProduction: null, cardSource: null, openingStockWanted: null, dismissed: false, tour: null, hints: { warehouseId: null, recipeId: null, parasut: { connected: false, openingEnabled: false, openingTakenAt: null } }, steps: STEP_KEYS.map(key => ({ key, done: key === 'cards', skipped: false, count: key === 'cards' ? 1 : 0 })), done: 1, total: 8, complete: false, next: 'cards' };
        const v = filterJourney(j, ['stock', 'labels']);
        expect(v.done).toBe(0);
        expect(v.total).toBe(2);
        expect(v.next).toBe('stock');
        expect(v.steps.map(s => s.key)).toEqual(['stock', 'labels']);
    });
});
