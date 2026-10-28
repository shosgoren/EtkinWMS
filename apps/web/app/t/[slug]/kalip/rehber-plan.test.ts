import { guideAccess } from './rehber-access.ts';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { currentGuide, GUIDE_INSTRUCTIONS, OP_GUIDES, guideAdvance, guideHref, guideScreen } from './rehber-plan.ts';
import { ADIM_KAYNAKLARI, ADIM_REHBERLERI, adimPlani } from './adim-rehber-plan.ts';
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
// T-1124: sıralı odak — adım ekranın kendi "bitti" işaretiyle ilerler; hedef çapaları ekran kodunda gerçekten var.
describe('T-1124 işlem rehberi adım ilerlemesi ve hedef çapaları', () => {
    const vis = (...shown: string[]) => (sel: string) => shown.some(x => sel.split(',').map(s => s.trim()).includes(x));
    const tr = GUIDE_INSTRUCTIONS.transfer;
    it('bitti işareti görününce sıradaki adıma, önceden dolmuş adımlar ardışık atlanır; algılanamayan adımda durur', () => {
        expect(guideAdvance(tr, 0, vis('[data-guide="source"]'))).toBe(0);
        expect(guideAdvance(tr, 0, vis('[data-guide="source"]', '[data-guide-done~="source"]'))).toBe(1);
        expect(guideAdvance(tr, 0, vis('[data-guide="source"]', '[data-guide-done~="source"]', '[data-guide-done~="target"]'))).toBe(2);
        // Miktar önce yazıldı ama kaynak seçilmedi: sıra korunur, kaynakta kalınır.
        expect(guideAdvance(tr, 0, vis('[data-guide="source"]', '[data-guide-done~="quantity"]'))).toBe(0);
        // Son adım: belge kaydedildi → rehber biter.
        expect(guideAdvance(tr, 4, vis('[data-testid="document-state"]'))).toBe(5);
        const rc = GUIDE_INSTRUCTIONS.receive;
        expect(guideAdvance(rc, 2, vis('[data-testid="verify-card"]'))).toBe(2);
    });
    it('hedef ekranda yoksa ve sonraki adımın işi zaten bittiyse ileri atlanır (hızlı kullanıcı)', () => {
        const rc = GUIDE_INSTRUCTIONS.receive;
        expect(guideAdvance(rc, 2, vis('[data-testid="saved-summary"]'))).toBe(5);
        expect(guideAdvance(rc, 0, vis('[data-testid="scan-panel"]', '[data-tour="main"]'))).toBe(1);
        // Hedef görünüyorsa ileri atlama yapılmaz.
        expect(guideAdvance(rc, 3, vis('[data-testid="qty-display"]', '[data-testid="saved-summary"]'))).toBe(3);
    });
    it('rehberin bölümü: belge rehberi kaydedilen belgede sürer; başka ekran bölüm dışıdır', () => {
        expect(guideScreen('transfer', '/t/a/stock/documents', 'new=TRANSFER')).toBe(true);
        expect(guideScreen('transfer', '/t/a/stock/documents', 'id=1')).toBe(true);
        expect(guideScreen('transfer', '/t/a/stock/documents', 'new=STOCK_OUT')).toBe(false);
        expect(guideScreen('transfer', '/t/a/items', '')).toBe(false);
        expect(guideScreen('count', '/t/a/field/count', 'task=1')).toBe(true);
        expect(guideScreen('receive', '/t/a/field/receive', 'receipt=1')).toBe(true);
        expect(guideScreen('receive', '/t/a', '')).toBe(false);
    });
    it('her adımın hedef/bitti seçicisindeki çapa (data-testid / data-guide / data-tour) ekran kodunda var', () => {
        const root = path.resolve(import.meta.dirname, '..');
        const kaynak: string[] = [];
        const tara = (dir: string): void => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) tara(p); else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/rehber-plan\.ts$|adim-rehber-plan\.ts$/.test(f)) kaynak.push(readFileSync(p, 'utf8')); } };
        tara(root);
        const metin = kaynak.join('\n');
        const secici = [...OP_GUIDES.flatMap(g => GUIDE_INSTRUCTIONS[g].flatMap(s => [s.target, s.done ?? ''])), ...ADIM_REHBERLERI.flatMap(r => ADIM_KAYNAKLARI.flatMap(k => adimPlani(r, k).flatMap(a => [a.target, 'sel' in a.done ? a.done.sel : '']))) ];
        const capalar = new Set<string>();
        for (const s of secici) for (const m of s.matchAll(/\[data-(testid|guide|tour|guide-done)[~]?="([^"]+)"\]/g)) capalar.add(`${m[1]}=${m[2]}`);
        expect(capalar.size).toBeGreaterThan(20);
        for (const c of capalar) {
            const [tur, ad] = c.split('=') as [string, string];
            const var_ = tur === 'testid' ? new RegExp(`(data-testid=|testId[:=] ?\\{?)["'\`]${ad.replace(/[-]/g, '\\-')}["'\`]`).test(metin) || (ad.startsWith('flow-') && metin.includes('data-testid={`flow-${')) : tur === 'guide-done' ? metin.includes('data-guide-done=') && metin.includes(`"${ad}"`) : metin.includes(`data-${tur}="${ad}"`);
            expect(var_, `${c} ekran kodunda yok`).toBe(true);
        }
    });
});

