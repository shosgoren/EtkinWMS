// T-279: ekran ölçümü yardımcıları ve Ürünler ekranı denetimleri (T-254/T-270/T-274; mobile-shell.spec.ts ve empty-tenant.spec.ts ortak).
// Değerler/assertion'lar mobile-shell.spec.ts'ten TAŞINDI; ürünler ekranı denetimi iki kiracı durumuna ayrıldı (bkz. itemsScreenChecks).
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

export const OUT_T274 = process.env.T274_OUT ?? path.resolve(import.meta.dirname, "../../../.artifacts/t-274");
export const T270_SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

export interface Metrics {
  readonly scrollHeight: number;
  readonly innerHeight: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

export async function metrics(page: Page): Promise<Metrics> {
  // Dize ifadesi: kök tsconfig'de DOM tipleri yok (lib: ES2023); ifade tarayıcıda çalışır.
  return page.evaluate<Metrics>(
    "({ scrollHeight: document.scrollingElement.scrollHeight, innerHeight: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })",
  );
}

/** Görünür etkileşimli öğelerin (bağlantı, düğme, odaklanabilir kart) 48x48 altında kalanları. */
export async function smallTargets(page: Page, scope: string): Promise<string[]> {
  return page.evaluate<string[]>(`(() => {
    const root = document.querySelector(${JSON.stringify(scope)}) ?? document.body;
    const out = [];
    for (const el of root.querySelectorAll('a[href], button, summary, [tabindex="0"], input, select, textarea')) {
      if (el.matches('a[href="#main"]')) continue; // yalnızca odaklanınca görünen atlama bağlantısı
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 47.5 || r.height < 47.5) out.push((el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40) + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    return out;
  })()`);
}

/**
 * T-274 B-02 (DESIGN_REVIEW §7.3): içerik ya da etkileşimli öğe içermeyen en büyük dikey bant. Alan: ana içerik alanı (üst çubuk altı – alt sekme
 * üstü); `panel` verilirse (alt sayfa açık) yalnız o kutu (kararmış zemin sayılmaz). İçerik öğesi: etkileşimli öğe (kutusu), metin düğümü
 * (metnin kendi kutusu), svg simgesi. Kenarlıklı/boyalı kutular tek başına içerik sayılmaz.
 */
export async function expectBand(page: Page, where: string, panel: string | null, assertBand = true): Promise<number> {
  const max = await page.evaluate<number>(`(() => {
    const r = (el) => el.getBoundingClientRect();
    const bar = r(document.querySelector('[data-testid="app-bar"]')), nav = r(document.querySelector('[data-testid="bottom-nav"], [data-testid="screen-nav"]'));
    const root = ${panel === null ? "document.body" : `document.querySelector(${JSON.stringify(panel)})`};
    const area = ${panel === null ? "{ top: bar.bottom, bottom: nav.top }" : `(() => { const b = r(root); return { top: b.top, bottom: b.bottom }; })()`};
    const spans = [];
    const add = (b) => { if (b.width > 0 && b.height > 0) spans.push([Math.max(b.top, area.top), Math.min(b.bottom, area.bottom)]); };
    const isVisible = (el) => el.checkVisibility && el.checkVisibility();
    for (const el of root.querySelectorAll('*')) {
      if (!isVisible(el)) continue;
      if (el.closest('.now-card[data-state="empty"]')) continue; // "Bekleyen iş yok" kartı içerik sayılmaz (DESIGN_REVIEW §7.4.1); hata ve gerçek veri satırı sayılır
      if (el.matches('a[href], button, summary, input, select, textarea, [tabindex="0"]')) { add(r(el)); continue; }
      if (el.tagName.toLowerCase() === 'svg') { add(r(el)); continue; }
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim() !== '') { const g = document.createRange(); g.selectNodeContents(n); for (const q of g.getClientRects()) add(q); }
      }
    }
    const iv = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let cursor = area.top, best = 0;
    for (const [a, b] of iv) { best = Math.max(best, a - cursor); cursor = Math.max(cursor, b); }
    best = Math.max(best, area.bottom - cursor);
    return best;
  })()`);
  // T-280 (DESIGN_REVIEW §7.4.1): "bekleyen iş yok" durumunda 2 sütun ana ekranda boşluk dürüstçe ÖLÇÜLÜR ve kaydedilir, assert edilmez (assertBand=false).
  if (assertBand) expect(max, `${where}: en büyük boş dikey bant (B-02)`).toBeLessThanOrEqual(120);
  return max;
}

/** T-274 B-04: genişleyen denetimde görünür şevron: sağda, ≥ 48 px yükseklik; açılınca döner (aynı dönüş). */
export async function chevronInfo(page: Page, control: string): Promise<{ h: number; rightGap: number; rotated: boolean }> {
  return page.evaluate<{ h: number; rightGap: number; rotated: boolean }>(`(() => {
    const el = document.querySelector(${JSON.stringify(control)});
    const svg = el.querySelector(':scope > svg:last-of-type');
    const a = el.getBoundingClientRect(), b = svg.getBoundingClientRect();
    return { h: a.height, rightGap: a.right - b.right, rotated: getComputedStyle(svg).transform !== 'none' || (getComputedStyle(svg).rotate !== 'none' && getComputedStyle(svg).rotate !== '0deg') };
  })()`);
}

// T-968 (B-63): Ürünler ekranı LİSTE kalıbında (KalipListe.dc.html). Eski T-274 ölçümleri (Gelişmiş altında Durum, sabit "Yeni ürün" çubuğu,
// kurulum satırı metni) kalıbın yapısıyla değişti; aynı niyet korunur: tek arama alanı, kiracı kabuğunun eski süslemeleri yok, ana işlem alt
// cam çubukta (ÜRÜN EKLE / DEPO EKLE), ürün yokken öğreten kurulum rehberi (3 adım, şimdiki adım doğru ekrana götürür), kart ≥ 48 px,
// sayfa gövdesi kaymaz, yatay taşma yok, "Arşivli" süzgeci adresi değiştirir.
// T-279: demo tenant dolu açılır (T-223); iki kiracı durumu ayrı denetlenir (`empty: true` = depo/ürün yok).
export interface ItemsTenant {
  readonly slug: string;
  readonly empty: boolean;
}

export async function itemsScreenChecks(page: Page, tenant: ItemsTenant): Promise<void> {
  const base = `/t/${tenant.slug}`;
  mkdirSync(OUT_T274, { recursive: true });
  const tag = test.info().project.name;
  for (const size of T270_SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(`${base}/items`);
    const where = `ürünler ${size.width}x${size.height}`;
    const screen = page.getByTestId("items");
    await expect(screen).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Ürünler" })).toBeVisible();
    // Kalıp ekranında kiracı kabuğunun eski süslemeleri çizilmez (kalip-frame.css genel kuralı).
    for (const old of ["screen-nav", "app-bar", "bottom-nav", "tenant-bar"]) await expect(page.getByTestId(old), `${where}: eski ${old} gizli`).toBeHidden();
    await expect(page.locator(".app-header")).toBeHidden();
    await expect(page.locator(".screen-context")).toBeHidden();
    await expect(page.getByTestId("kabuk-dock"), `${where}: ortak alt cam çubuk`).toBeVisible();
    // I-01: tek görünür arama alanı; ayrı "Ara" düğmesi yok.
    const form = page.getByRole("search", { name: "Ürün ara" });
    const box = page.getByRole("searchbox", { name: "Ürün ara" });
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute("placeholder", "Ürün ara: ad, kod ya da barkod");
    await expect(form.locator("input:visible")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Ara", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Barkodu kamerayla okut" })).toBeVisible();
    const main = page.getByTestId("items-add");
    await expect(main, `${where}: ana işlem alt çubukta`).toBeVisible();
    if (tenant.empty) {
      // Kurulum rehberi: 3 adım; şimdiki adım (depo) depo formuna götürür; ana işlem DEPO EKLE.
      const steps = page.getByTestId("setup-steps");
      await expect(steps, `${where}: kurulum rehberi`).toBeVisible();
      await expect(steps.locator("[data-step]")).toHaveCount(3);
      await expect(steps.locator('[data-step="warehouse"]')).toHaveAttribute("href", `${base}/warehouses?new=1`);
      await expect(main).toHaveAccessibleName("Depo ekle");
    } else {
      await expect(page.getByTestId("setup-steps"), `${where}: kurulum tamam, rehber yok`).toHaveCount(0);
      // Kart bir bağlantıdır ama rolü kaynaktaki gibi listitem (`.ulist > .uc`); ad "Ayrıntıyı aç: …".
      const rows = page.getByTestId("item-card");
      await expect(rows.first()).toBeVisible();
      await expect(rows.first()).toHaveAccessibleName(/^Ayrıntıyı aç: /);
      await expect(rows.first()).toHaveAttribute("href", /\/items\/[0-9a-f-]{36}$/);
      expect(await rows.count(), `${where}: demo ürün kartları görünür`).toBeGreaterThanOrEqual(3);
      expect((await rows.first().boundingBox())?.height ?? 0, `${where}: kart yüksekliği`).toBeGreaterThanOrEqual(48);
      await expect(main).toHaveAccessibleName("Yeni ürün");
    }
    // Dokunma hedefi ölçüleri kaynak tasarımdandır (I-18; ör. telefonda çip 40 px, arama düğmeleri 44 px): eski 48 px ölçümü bu ekranda yok.
    const m = await metrics(page);
    expect(m.scrollWidth, `${where}: yatay taşma`).toBeLessThanOrEqual(m.clientWidth);
    expect(m.scrollHeight, `${where}: sayfa gövdesi kaymaz`).toBeLessThanOrEqual(m.innerHeight);
    await page.screenshot({ path: path.join(OUT_T274, `final-${tag}-items-${size.width}.png`) });
    // Süzgeç: "Arşivli" çipi adresi değiştirir; her kart arşivli ya da süzgece özgü boş durum.
    await page.getByRole("group", { name: "Süzgeç" }).getByRole("link", { name: /Arşivli/ }).click();
    await expect(page).toHaveURL(/status=ARCHIVED/);
    const cards = page.getByTestId("item-card");
    await expect(cards.first().or(page.getByText("Bulunamadı · ara ya da söyle", { exact: true }))).toBeVisible();
    const n = await cards.count();
    for (let i = 0; i < n; i++) await expect(cards.nth(i).locator("[data-status]"), `${where}: arşivli süzgeçte kart`).toHaveAttribute("data-status", "ARCHIVED");
    await page.goto(`${base}/items?status=ARCHIVED&q=zzyok${Date.now().toString(36)}`);
    await expect(page.getByText("Bulunamadı · ara ya da söyle", { exact: true })).toBeVisible(); // ALTIN-KURAL 8: ortak cümle
    await expect(page.getByRole("link", { name: "Aramayı temizle" })).toHaveAttribute("href", `${base}/items`);
    await page.screenshot({ path: path.join(OUT_T274, `final-${tag}-items-${size.width}-arsivli.png`) });
  }
  // Kurulum: şimdiki adıma dokunmak doğrudan depo eklemeye götürür.
  if (tenant.empty) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/items`);
    await page.getByTestId("setup-steps").locator('[data-step="warehouse"]').click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenant.slug}/warehouses`));
  }
  await page.goto(base); // depo formu açık kalmasın (çıkış menüsü önde)
}
