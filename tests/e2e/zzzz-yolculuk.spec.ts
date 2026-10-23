// T-1026: gerçek form/menüyle çalışılabilen kısa tur; tamamlanan işlemi tekrar; bağımsız rehberler.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginEmptyTenant, localClient, scrubSecretInputs } from './support/empty-tenant.ts';
import { KABUK_SIZES, settle } from './support/kabuk-checks.ts';
const OUT = path.resolve('tests/.artifacts/t-1026');
async function close(page: Page): Promise<void> {
    const x = page.getByTestId('yol-close');
    if (await x.isVisible()) {
        await x.click();
        await expect(page.getByTestId('yol-coach')).toBeHidden();
    }
    const g = page.getByTestId('guide-close');
    if (await g.isVisible())
        await g.click();
}
async function openSetup(page: Page, slug: string, key: string): Promise<void> {
    await close(page);
    await page.goto(`/t/${slug}`);
    await page.getByTestId('yol-card').click();
    await page.getByTestId(`yol-start-${key}`).click();
    await expect(page.getByTestId('yol-sheet')).toBeHidden();
    await expect(page.getByTestId('yol-coach')).toHaveAttribute('data-step', key);
    if (key === 'stock')
        await expect(page.locator('form.workflow-form')).toBeVisible();
    await expect.poll(async () => { const expand = page.getByTestId('guide-expand'); if (await expand.isVisible())
        await expand.click(); return page.getByTestId('working-guide').getAttribute('data-folded'); }).toBe('false');
}
if (!process.env.E2E_BASE_URL?.trim()) {
    test.use({ ...localClient('198.51.100.29'), trace: 'off', actionTimeout: 15000 });
    test.beforeEach(({}, info) => {
        const scenario = info.title.startsWith('kurulum rehberi') ? 'SETUP' : info.title.startsWith('geciken') ? 'RACE' : 'OP';
        const device = info.project.name === 'mobile' ? 'MOBILE' : 'DESKTOP';
        for (const key of ['SLUG', 'EMAIL', 'PASSWORD', 'TOTP_SECRET']) {
            const value = process.env[`E2E_TOUR_${scenario}_${device}_${key}`];
            if (!value) throw new Error('e2e: bağımsız rehber fikstürü yok');
            process.env[`E2E_TOUR_${key}`] = value;
        }
    });
    test.afterEach(async ({ page }) => { await scrubSecretInputs(page); });
    test('kurulum rehberi: form ve menü erişimi, geri/ileri, atla/geri al, tamamlanan adımı tekrar', async ({ page }, info) => {
        test.setTimeout(180000);
        mkdirSync(OUT, { recursive: true });
        const { slug } = await loginEmptyTenant(page, 'tour', { keepTour: true });
        await expect.poll(() => page.getByTestId('yol-layer').getAttribute('data-state')).toMatch(/^(on|off)$/);
        if (await page.getByTestId('yol-coach').isVisible()) {
            await expect(page.getByTestId('working-guide')).toContainText('/3');
            await page.keyboard.press('Escape');
        }
        await openSetup(page, slug, 'cards');
        await expect(page.locator('[data-tour="excel"]')).toBeVisible();
        await expect(page.getByTestId('kalip-perde')).toHaveCount(0);
        for (const { w, h } of KABUK_SIZES) {
            await page.setViewportSize({ width: w, height: h });
            await settle(page);
            if (await page.getByTestId('guide-expand').isVisible())
                await page.getByTestId('guide-expand').click();
            const card = page.getByTestId('working-guide');
            // setViewportSize resize olayını kuyruklar; ölçüm aynı sınırlarla yerleşimin güncellenmesini bekler.
            await expect.poll(async () => {
                const box = await card.boundingBox();
                return box !== null && box.x >= 0 && box.x + box.width <= w && box.y + box.height <= h;
            }).toBe(true);
            const r = await card.boundingBox();
            expect(r).not.toBeNull();
            expect(r!.x).toBeGreaterThanOrEqual(0);
            expect(r!.x + r!.width).toBeLessThanOrEqual(w);
            expect(r!.y + r!.height).toBeLessThanOrEqual(h);
            await page.screenshot({ path: path.join(OUT, `${info.project.name}-guide-${w}.png`), animations: 'disabled' });
        }
        await page.getByTestId('guide-apply').click();
        await expect(page.getByTestId('working-guide')).toHaveAttribute('data-folded', 'true');
        await page.locator('[data-tour="excel"]').click();
        await page.getByTestId('kalip-excel-import').click();
        await expect(page).toHaveURL(/\/import/);
        await page.getByTestId('aktar-file').setInputFiles({ name: 'guide-local.csv', mimeType: 'text/csv', buffer: Buffer.from('Kod,Ad,Birim\nQA-GUIDE,Yerel rehber,ADET\n') });
        await expect(page.getByText('guide-local.csv', { exact: true })).toBeVisible();
        const dirtyUrl = page.url();
        for (const action of ['skip', 'source']) {
            if (await page.getByTestId('guide-expand').isVisible()) await page.getByTestId('guide-expand').click();
            const sourceLabel = await page.getByTestId('yol-source').textContent();
            if (action === 'skip') await page.getByTestId('working-guide').getByRole('button', { name: 'Atla', exact: true }).click();
            else await page.getByTestId('yol-source').click();
            await expect(page.getByTestId('kalip-unsaved-stay')).toBeVisible();
            await page.getByTestId('kalip-unsaved-stay').click();
            await expect(page).toHaveURL(dirtyUrl);
            await expect(page.getByTestId('yol-coach')).toHaveAttribute('data-step', 'cards');
            if (await page.getByTestId('guide-expand').isVisible()) await page.getByTestId('guide-expand').click();
            await expect(page.getByTestId('yol-source')).toHaveText(sourceLabel!);
            await expect(page.getByText('guide-local.csv', { exact: true })).toBeVisible();
            await expect(page.getByTestId('kalip-toast').filter({ hasText: 'atlandı' })).toHaveCount(0);
        }
        await close(page);
        await page.getByRole('link', { name: 'Ana ekran', exact: true }).click();
        await page.getByTestId('kalip-unsaved-leave').click();
        await openSetup(page, slug, 'stock');
        await page.getByTestId('working-guide').getByRole('button', { name: 'Atla', exact: true }).click();
        await expect(page.getByTestId('kalip-toast')).toContainText('atlandı');
        await page.getByTestId('balon-eylem').click();
        await close(page);
        await openSetup(page, slug, 'shelves');
        await page.locator('[data-tour="main"]').click();
        const form = page.getByTestId('warehouse-form');
        await expect(form).toBeVisible();
        await form.locator('input[name="name"]').fill(`QA rehber ${info.project.name}`);
        await expect(form.locator('input[name="name"]')).toHaveValue(`QA rehber ${info.project.name}`);
        await expect(page.getByTestId('kalip-perde')).toHaveCount(0);
        await page.getByTestId('guide-expand').click();
        await expect(page.getByTestId('working-guide')).toContainText('önerilen kodu');
        // Formu doldurmak gerçek iş; rehber İleri'si işlemi kaydetmez. Yarım işte gezinme ortak korumayı korur.
        await page.getByTestId('guide-next').click();
        await expect(page.getByTestId('kalip-unsaved-stay')).toBeVisible();
        await page.getByTestId('kalip-unsaved-stay').click();
        await expect(form).toBeVisible();
        await close(page);
        await page.getByTestId('kabuk-back').click();
        if (await page.getByTestId('kalip-unsaved-leave').isVisible())
            await page.getByTestId('kalip-unsaved-leave').click();
        await openSetup(page, slug, 'people');
        await expect(page.getByTestId('team-people')).toBeVisible();
        await page.locator('[data-tour="main"]').click();
        await page.getByTestId('team-add-qr').click();
        await expect(page.getByTestId('team-qr-new')).toBeVisible();
        // Yalnız menü denetlenir: gerçek davet/QR üretme/paylaşma yok.
        await close(page);
        await page.goto(`/t/${slug}/items?new=1`);
        const item = page.getByTestId('item-form');
        await item.locator('input[name="name"]').fill(`QA tekrar ${info.project.name}`);
        await item.locator('input[name="code"]').fill(`QA-${info.project.name.toUpperCase()}-REPLAY`);
        await page.getByTestId('item-form-save').click();
        await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
        await openSetup(page, slug, 'cards');
        await expect(page.getByTestId('working-guide')).toBeVisible();
        await page.reload();
        await expect(page.getByTestId('yol-coach')).toHaveAttribute('data-step', 'cards');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('yol-coach')).toBeHidden();
        await page.reload();
        await expect(page.getByTestId('yol-coach')).toBeHidden();
    });
    test('beş işlem bağımsız açılır, form erişimi ve kişisel devam; EN yanıltıcı ses komutu yok', async ({ page }, info) => {
        test.setTimeout(180000);
        mkdirSync(OUT, { recursive: true });
        const initial = await loginEmptyTenant(page, 'tour');
        for (const route of ['/field/receive', '/field/putaway', '/stock/documents?new=STOCK_OUT', '/field/tasks?kind=COUNT']) {
            await page.goto(`/t/${initial.slug}${route}`);
            await page.getByTestId('operation-guide-trigger').click();
            await expect(page.getByTestId('working-guide')).toHaveCount(1);
            await expect(page.getByTestId('working-guide')).toContainText('Adım 1/5');
            for (const button of await page.getByTestId('working-guide').getByRole('button').all()) {
                const box = await button.boundingBox();
                expect(box?.width).toBeGreaterThanOrEqual(48);
                expect(box?.height).toBeGreaterThanOrEqual(48);
            }
            await page.getByTestId('guide-next').click();
            await expect(page.getByTestId('working-guide')).toContainText('Adım 2/5');
            await page.getByTestId('working-guide').getByRole('button', { name: 'Geri', exact: true }).click();
            await expect(page.getByTestId('working-guide')).toContainText('Adım 1/5');
            await close(page);
        }
        await page.goto(`/t/${initial.slug}`);
        await page.getByTestId('pano-help').click();
        await page.getByTestId('support-guide').click();
        const picker = page.getByTestId('guide-picker');
        await expect(picker).toBeVisible();
        for (const g of ['receive', 'putaway', 'issue', 'transfer', 'count'])
            await expect(page.getByTestId(`guide-start-${g}`)).toBeVisible();
        await page.getByTestId('guide-start-transfer').click();
        await expect(page).toHaveURL(/new=TRANSFER/);
        await expect(page.getByTestId('working-guide')).toContainText('Kaynak depoyu');
        await page.getByTestId('guide-apply').click();
        const input = page.locator('[data-guide="source"] input').first();
        await input.fill('QA');
        await expect(input).toHaveValue('QA');
        await expect(page.getByTestId('kalip-perde')).toHaveCount(0);
        await page.getByTestId('guide-expand').click();
        await page.getByTestId('guide-next').click();
        await expect(page.getByTestId('working-guide')).toContainText('Hedef depoyu');
        await page.reload();
        await expect(page.getByTestId('working-guide')).toContainText('Hedef depoyu');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('working-guide')).toBeHidden();
        await page.getByTestId('operation-guide-trigger').click();
        await expect(page.getByTestId('working-guide')).toContainText('Adım 2/5');
        await page.getByTestId('guide-restart').click();
        await expect(page.getByTestId('working-guide')).toContainText('Adım 1/5');
        await close(page);
        await page.context().addCookies([{ name: 'locale', value: 'en', url: new URL(page.url()).origin }]);
        await page.reload();
        await page.getByTestId('operation-guide-trigger').click();
        await expect(page.getByTestId('working-guide')).toContainText('Search and select the source');
        await expect(page.getByTestId('working-guide')).not.toContainText('Say:');
        await page.getByTestId('guide-next').click();
        await page.goto(`/t/${new URL(page.url()).pathname.split('/')[2]}/field/tasks?kind=COUNT`);
        await page.goBack();
        await expect(page.getByTestId('working-guide')).toContainText('Step 2/5');
        await page.goForward();
        await expect(page.getByTestId('working-guide')).toContainText('Step 2/5');
        await page.goBack();
        await page.setViewportSize({ width: 390, height: 690 });
        await settle(page);
        await page.screenshot({ path: path.join(OUT, `${info.project.name}-en-390.png`), animations: 'disabled' });
        await page.getByTestId('guide-apply').click();
        await expect(page.getByTestId('working-guide')).toHaveAttribute('data-folded', 'true');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('working-guide')).toBeHidden();
        await page.context().clearCookies();
        const again = await page.context().newPage();
        const actor = await loginEmptyTenant(again, 'tour');
        await again.goto(`/t/${actor.slug}/stock/documents?new=TRANSFER`);
        await again.getByTestId('operation-guide-trigger').click();
        await expect(again.getByTestId('working-guide')).toContainText('Adım 2/5');
        await again.close();
    });
    test('geciken ACTIVE yanıtı kapatılmış turu gezindirmez ve işlem rehberinin üstüne seçici açmaz', async ({ page }) => {
        test.setTimeout(120000);
        const { slug } = await loginEmptyTenant(page, 'tour', { keepTour: true });
        await expect(page.getByTestId('yol-coach')).toHaveAttribute('data-step', 'cards');
        let held = false;
        let release!: () => void;
        let releaseClose!: () => void;
        const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        await page.route('**/t/**', async route => {
            const request = route.request();
            let args: unknown;
            try { args = request.postDataJSON(); } catch { /* GET / RSC */ }
            const input = Array.isArray(args) ? args[0] as Record<string, unknown> | undefined : undefined;
            const isRead = input && Object.keys(input).length === 1;
            const isClose = input?.tour === 'close';
            if (request.method() !== 'POST' || !request.headers()['next-action'] || !input || (!isRead && !isClose) || input.slug !== slug) {
                await route.continue(); return;
            }
            const response = await route.fetch();
            const body = await response.text();
            if (!held && body.includes('"key":"cards","done":true') && body.includes('"tour":"ACTIVE"')) {
                held = true;
                await gate;
            }
            if (isClose && held) await closeGate;
            await route.fulfill({ response, body });
        });
        try {
            const editor = await page.context().newPage();
            try {
                await editor.goto(`/t/${slug}/items?new=1`);
                const form = editor.getByTestId('item-form');
                await form.locator('input[name="name"]').fill('Geciken rehber yerel QA');
                await form.locator('input[name="code"]').fill('QA-GUIDE-RACE');
                await editor.getByTestId('item-form-save').click();
                await expect(editor).toHaveURL(/\/items\/[0-9a-f-]+$/);
            } finally { await editor.close(); }
            await expect.poll(() => held, { timeout: 20000 }).toBe(true);
            await page.getByTestId('pano-help').click();
            await page.getByTestId('support-guide').click();
            await page.getByTestId('guide-start-transfer').click();
            release();
            await expect(page).toHaveURL(/new=TRANSFER/);
            await expect(page.getByTestId('working-guide')).toHaveCount(1);
            // Üründeki 1500ms otomatik geçiş zamanlayıcısının süresi boyunca eski yanıt etkisiz kalmalı.
            await page.waitForTimeout(2200);
            await expect(page).toHaveURL(/new=TRANSFER/);
            await expect(page.getByTestId('yol-sheet')).toHaveCount(0);
            await expect(page.getByTestId('yol-coach')).toHaveCount(0);
            await expect(page.getByTestId('working-guide')).toContainText('Transfer');
        } finally { release(); releaseClose(); await page.unrouteAll({ behavior: 'wait' }); }
    });

}
