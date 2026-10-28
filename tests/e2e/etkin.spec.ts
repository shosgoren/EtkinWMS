// T-1002 (B-62): Etkin bas-konuş uçtan uca — sahte iç ses servisiyle (tests/e2e/support/fake-voice.ts). Mikrofon test çifti: getUserMedia
// 440 Hz osilatör akışı döndürür (Chromium'un sahte aygıt bayrağı macOS başsız kipte izin beklerken asılı kalıyor; kayıt/WAV yolu aynı).
// Basılı tut (≈1,2 sn) → buzlu dinleme perdesi → "Anladım" kartı (işlem, miktar, ürün, raf çipleri) → Onayla → başarı nabzı + mevcut stok
// belgesi taslağı (createManualStockAction) açılır. İkinci tur: kart açıkken uzun basış (≥2 sn) sahte serviste "Onayla." → sesli onay (A-172).
import { expect, test, type Page } from "@playwright/test";
import { enterDemoShared } from "./support/demo-session.ts";

test.beforeEach(async ({ page }) => {
  // Tarayıcıda çalışan betik metni (e2e tsconfig'inde DOM tipleri yok; diğer spec'ler de değerlendirmeyi metinle yapar).
  await page.addInitScript(`navigator.mediaDevices.getUserMedia = () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    return Promise.resolve(dest.stream);
  };`);
});

async function hold(page: Page, ms: number): Promise<void> {
  const btn = page.getByTestId("kabuk-etkin").filter({ visible: true });
  const box = await btn.boundingBox();
  if (box === null) throw new Error("Etkin düğmesi görünmüyor");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("etkin-veil")).toHaveAttribute("data-state", "listen");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("Etkin: bas-konuş → Anladım kartı → Onayla (dokunuş ve sesli)", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await expect(page).toHaveURL(/\/t\/demo$/);

  // 1) Dokunuşla onay.
  await hold(page, 1200);
  const card = page.getByTestId("etkin-confirm");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole("dialog", { name: "Anladım" })).toBeVisible();
  await expect(card).toContainText("STOĞU DEĞİŞTİRİR");
  await expect(card).toContainText("GİRİŞ");
  await expect(card).toContainText("Ahşap palet 80x120");
  await expect(card).toContainText("A1-G01");
  await card.getByTestId("etkin-approve").click();
  await expect(page.getByTestId("etkin-fb")).toHaveAttribute("data-ok", "true");
  await expect(page).toHaveURL(/\/t\/demo\/stock\/documents\?id=[0-9a-f-]{36}$/, { timeout: 15_000 });

  // 2) Sesli onay: kart açıkken tam "onayla".
  await hold(page, 1200);
  await expect(page.getByTestId("etkin-confirm")).toBeVisible({ timeout: 20_000 });
  await hold(page, 2600);
  await expect(page.getByTestId("etkin-fb")).toHaveAttribute("data-ok", "true", { timeout: 20_000 });
  await expect(page).toHaveURL(/\/t\/demo\/stock\/documents\?id=[0-9a-f-]{36}$/, { timeout: 15_000 });
  expect(await page.evaluate<boolean>("document.documentElement.scrollWidth <= window.innerWidth")).toBe(true);
});

// T-1103: sistem iptali (iOS kenar hareketi, gelen arama) bırakma değildir — kayıt gönderilmez, "Anladım" kartı açılmaz, dinleme kapanır.
test("Etkin: basılıyken sistem iptali kaydı göndermez", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await expect(page).toHaveURL(/\/t\/demo$/);
  const btn = page.getByTestId("kabuk-etkin").filter({ visible: true });
  const box = await btn.boundingBox();
  if (box === null) throw new Error("Etkin düğmesi görünmüyor");
  let sent = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"] !== undefined && (r.postData() ?? "").includes('"audio"')) sent++;
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId("etkin-veil")).toHaveAttribute("data-state", "listen");
  await page.waitForTimeout(900);
  await btn.dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true, pointerType: "touch" });
  await page.mouse.up();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("etkin-confirm")).toHaveCount(0);
  expect(sent).toBe(0);
});

// T-1110 (kullanıcı 28 Ekim): doğal söyleyişler — ekli ekran adı ekranı açar, "bekleyen iş" kişinin görevlerini okur.
test("Etkin: 'Ürünleri aç' ekranı açar, 'Bekleyen işim var mı?' görevleri gösterir", async ({ page }) => {
  await page.goto("/");
  await enterDemoShared(page, "Yönetici");
  await expect(page).toHaveURL(/\/t\/demo$/);
  await hold(page, 4200);
  await expect(page).toHaveURL(/\/t\/demo\/items$/, { timeout: 20_000 });
  await hold(page, 5700);
  await expect(page.getByTestId("etkin-read")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("etkin-read")).toContainText("Görevlerim");
});
