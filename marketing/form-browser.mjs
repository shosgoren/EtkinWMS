// Isolated browser regression; no external requests or real notifications.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
const dir = await mkdtemp(join(tmpdir(), 'demo-browser-'));
process.env.LEAD_DIR = dir;
delete process.env.SITE_CONTENT_URL;
const { server } = await import('./server.mjs');
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
const shots = process.env.DEMO_SCREENSHOTS || join(tmpdir(), 'etkin-demo-shots');
await mkdir(shots, { recursive: true });
try {
  for(const width of [390,1180,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    let calls=0;
    await page.route('**/*',async route=>{
      if(!route.request().url().startsWith(base))return route.abort();
      if(!route.request().url().endsWith('/api/demo-status'))return route.continue();
      calls++;return route.fulfill({json:{status:'setup',href:'https://wms.etkinyazilim.com/activate/'+'b'.repeat(43)}});
    });
    await page.goto(base+'/demo-status#'+'a'.repeat(43));
    assert.equal(new URL(page.url()).hash,'');assert.equal(calls,0);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    await page.screenshot({path:join(shots,`owner-${width}-TR.png`)});
    await page.getByRole('button',{name:'Talebimi görüntüle'}).click();
    await page.locator('#owner-next').waitFor({state:'visible'});
    assert.equal(calls,1);
    assert.equal(await page.locator('#owner-title').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator('#owner-next').getAttribute('href'),'https://wms.etkinyazilim.com/activate/'+'b'.repeat(43));
    await page.getByRole('button',{name:'EN',exact:true}).click();
    assert.match(await page.locator('#owner-message').innerText(),/approved/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:join(shots,`owner-${width}-EN.png`)});
    await page.close();
  }
  for (const [width, language] of [[390, "TR"], [1180, "TR"], [1440, "TR"], [390, "EN"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    let sends = 0;
    let payload;
    await page.route('**/*', async route => {
      if (!route.request().url().startsWith(base)) return route.abort();
      if (!route.request().url().endsWith('/api/demo')) return route.continue();
      sends++;
      const next = route.request().postDataJSON();
      if (payload) assert.equal(next.requestId, payload.requestId);
      payload = next;
      if (sends === 1) return route.abort('failed');
      await new Promise(resolve => setTimeout(resolve, 200));
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto(base + '/#demo');
    if (language === 'EN') await page.getByRole('button', { name: 'EN', exact: true }).click();
    const form = page.locator('#demo-form');
    await form.locator('[type=submit]').click();
    assert.equal(await form.locator('[name=name]').getAttribute('aria-invalid'), 'true');
    for (const [name, value] of Object.entries({ name: 'Synthetic Person', company: 'Synthetic Company', email: 'synthetic@example.test', message: 'Synthetic test only' })) {
      await form.locator(`[name=${name}]`).fill(value);
    }
    for (const name of ['name', 'company', 'email']) assert.match(await form.locator(`[name=${name}]`).locator('..').innerText(), /\*/);
    await form.locator('[name=sector][value=manufacturing]').check();
    await form.locator('[name=sector][value=manufacturing]').press('ArrowRight');
    assert.equal(await form.locator('[name=sector][value=wholesale]').isChecked(), true);
    await form.locator('a[href="/privacy"]').click();
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#dc-root').evaluate(el => el.inert), true);
    await page.getByRole('dialog').getByRole('link', { name: 'Demo formuna dön' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await form.locator('[name=name]').inputValue(), 'Synthetic Person');
    assert.equal(await form.locator('[name=sector][value=wholesale]').isChecked(), true);
    await form.locator('[name=consent]').check();
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(shots, `form-${width}-${language}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await form.locator('[type=submit]').click();
    await form.locator('.fretry').waitFor();
    assert.equal(await form.locator('[name=email]').inputValue(), 'synthetic@example.test');
    await form.locator('.fretry').click();
    await form.evaluate(el => el.requestSubmit());
    await page.getByTestId('demo-success').waitFor();
    assert.equal(sends, 2);
    assert.equal(await page.locator('#demo-done-title').evaluate(el => el === document.activeElement), true);
    await page.close();
  }
  console.log('form browser: TR 3 widths + EN mobile PASS; privacy, validation, keyboard choice, retry, double submit, success focus');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
