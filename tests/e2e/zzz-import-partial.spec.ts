// T-289: "yarım kaldı" senaryosu — YALNIZ YEREL yığın. Test-yalnız DB tetikleyicisi `psql` ile yerel veritabanına kurulur (üretim koduna kanca yok), bu yüzden
// uzak hedefte (E2E_BASE_URL, staging) çalışmaz: `playwright.config.ts` bu dosyayı uzak koşudan dışlar (atlama değil; bu koşuda yerel veritabanı kavramı yoktur).
// Demo tenant'a kendi benzersiz önekli ürünlerini ve stokunu yazar; iş bitince tetikleyici/tablo kaldırılır.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { localClient } from "./support/empty-tenant.ts";
import { OUT, PRODUCT_HEADER, STOCK_HEADER, csv, loginAdmin } from "./support/import-screen.ts";

/** Yerel veritabanında SQL çalıştırır (`psql`; bağlantı dizgisi argv'de değil ortam değişkeninden okunur). Lint: `pg` sürücüsü e2e'de yasak. */
function runSql(script: string): void {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error("e2e: DATABASE_URL_DIRECT yok (kısmi başarısızlık senaryosu yerel yığın ister)");
  // Yalnız loopback: tetikleyici kuran bu betik uzak/paylaşılan bir veritabanına ASLA gitmez (global-setup ile aynı kural).
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error("e2e: DATABASE_URL_DIRECT loopback değil; enjeksiyon yalnız yerel veritabanında çalışır");
  execFileSync("sh", ["-c", 'psql "$DATABASE_URL_DIRECT" -X -q -v ON_ERROR_STOP=1'], { input: script, env: process.env, stdio: ["pipe", "ignore", "pipe"] });
}

/** TEST-YALNIZ hata enjeksiyonu (üretim kodunda kanca yok): yerel veritabanında demo tenant için belge ONAYI ya da belirli kodlu ürün EKLEMESİ başarısız olur; iş bitince tetikleyici ve tablo kaldırılır. */
async function withInjection<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[A-Za-z0-9:_-]+$/.test(what)) throw new Error("e2e: enjeksiyon anahtarı geçersiz");
  const cleanup = `DROP TRIGGER IF EXISTS t289_inject_docs ON public.documents; DROP TRIGGER IF EXISTS t289_inject_items ON public.items;
    DROP FUNCTION IF EXISTS public.t289_inject_fn(); DROP TABLE IF EXISTS public.t289_inject;`;
  try {
  runSql(`${cleanup}
    CREATE TABLE public.t289_inject (tenant_id uuid NOT NULL, what text NOT NULL, PRIMARY KEY (tenant_id, what));
    CREATE FUNCTION public.t289_inject_fn() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF TG_TABLE_NAME = 'documents' THEN
          IF OLD.status = 'DRAFT' AND NEW.status = 'APPROVED' AND NEW.reason = 'import.opening_stock'
             AND EXISTS (SELECT 1 FROM public.t289_inject WHERE tenant_id = NEW.tenant_id AND what = 'approve') THEN
            RAISE EXCEPTION 't289 injected approve failure' USING ERRCODE = 'XX000';
          END IF;
        ELSIF TG_TABLE_NAME = 'items' THEN
          IF EXISTS (SELECT 1 FROM public.t289_inject WHERE tenant_id = NEW.tenant_id AND what = 'item:' || NEW.code) THEN
            RAISE EXCEPTION 't289 injected item failure' USING ERRCODE = 'XX000';
          END IF;
        END IF;
        RETURN NEW;
      END $$;
    CREATE TRIGGER t289_inject_docs BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.t289_inject_fn();
    CREATE TRIGGER t289_inject_items BEFORE INSERT ON public.items FOR EACH ROW EXECUTE FUNCTION public.t289_inject_fn();
    INSERT INTO public.t289_inject (tenant_id, what) SELECT id, '${what}' FROM public.tenants WHERE slug = 'demo';`);
    return await fn();
  } finally {
    runSql(cleanup);
  }
}

// Demo girişi IP başına 10/10 dk sınırlıdır (auth signIn kuralı): bu dosya tüm paketin kovasını tüketmesin diye kendi istemci adresini kullanır (yalnız yerel vekil okur).
test.use({ ...localClient("198.51.100.41") });

// T-427: aynı senaryo "Excel'den aktar" ekranında (Aktar.dc.html). Sonuç adımı yarım kalan aktarımı sayılarıyla söyler; dosya yeniden seçilince tamamlanır.
test.describe("Excel'den aktar — yarım kalan (T-289/T-427, yerel)", () => {
  test("yarım kalan aktarım: hatalı/denenmedi sayıları, 20'den sonra 've N satır daha', yeniden yükleyince tamamlanır", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    mkdirSync(OUT, { recursive: true });
    const project = testInfo.project.name;
    const p = `T289-${Date.now()}${project === "desktop" ? "D" : "M"}P`;
    await loginAdmin(page);
    await page.goto("/t/demo/import");
    const aktar = page.getByTestId("aktar");
    const main = page.getByTestId("aktar-main");
    const run = async (kind: "stok" | "acilis", rows: string[]): Promise<void> => {
      await aktar.locator(`[data-kind="${kind}"]`).click();
      await page.getByTestId("aktar-file").setInputFiles(csv(rows));
      await expect(aktar.locator("[data-field]").first()).toBeVisible();
      await main.click(); // KONTROL ET
      await expect(page.getByTestId("aktar-bad")).toHaveText("0");
      await main.click(); // AKTAR
      await expect(page.getByTestId("aktar-done")).toBeVisible();
    };
    const again = async (): Promise<void> => {
      await main.click(); // BİTTİ → baştan
    };

    // 1) Ürün: ikinci satırda ürün kaydı başarısız (test-yalnız tetikleyici) → 1 eklendi, 1 hatalı, 1 denenmedi.
    const products = [PRODUCT_HEADER, `${p}-1;Bir;;;;`, `${p}-2;İki;;;;`, `${p}-3;Üç;;;;`];
    await withInjection(`item:${p}-2`, async () => {
      await run("stok", products);
      await expect(page.getByTestId("aktar-done")).toHaveAttribute("data-partial", "true");
      await expect(page.getByTestId("aktar-counts")).toContainText("1 YENİ");
      await expect(page.getByTestId("aktar-counts")).toContainText("1 HATALI");
      await expect(page.getByTestId("aktar-counts")).toContainText("1 DENENMEDİ");
      await expect(page.getByTestId("aktar-failed")).toContainText("SATIR 3");
      await expect(page.getByTestId("aktar-done")).not.toContainText("INTERNAL");
    });
    // Sorun giderildi: aynı dosya yeniden yüklenir, kalanlar tamamlanır.
    await page.getByTestId("aktar-retry").click();
    await page.getByTestId("aktar-file").setInputFiles(csv(products));
    await main.click();
    await main.click();
    await expect(page.getByTestId("aktar-done")).toHaveAttribute("data-partial", "false");
    await expect(page.getByTestId("aktar-counts")).toContainText("2 YENİ");
    await expect(page.getByTestId("aktar-counts")).toContainText("1 ZATEN VARDI");

    // 2) Stok: 25 satırlık belge onayda başarısız → 25 hatalı satır, 20'si listelenir ve "ve 5 satır daha hatalı" yazar.
    await again();
    const many = Array.from({ length: 25 }, (_, i) => `${p}-m${i}`);
    await run("stok", [PRODUCT_HEADER, ...many.map((c) => `${c};Ürün;;;;`)]);
    await expect(page.getByTestId("aktar-counts")).toContainText("25 YENİ");
    await again();
    const stockRows = [STOCK_HEADER, ...many.map((c) => `${c};A3-G04;5`)];
    await withInjection("approve", async () => {
      await run("acilis", stockRows);
      await expect(page.getByTestId("aktar-done")).toHaveAttribute("data-partial", "true");
      await expect(page.getByTestId("aktar-counts")).toContainText("25 HATALI");
      await expect(page.getByTestId("aktar-failed").locator(".pr")).toHaveCount(20);
      await expect(page.getByTestId("aktar-failed")).toContainText("ve 5 satır daha hatalı");
    });
    // Aynı dosya: yarım kalan belge sürdürülür, 25 satır eklenir.
    await page.getByTestId("aktar-retry").click();
    await page.getByTestId("aktar-file").setInputFiles(csv(stockRows));
    await main.click();
    await main.click();
    await expect(page.getByTestId("aktar-counts")).toContainText("25 YENİ");
    await page.screenshot({ path: path.join(OUT, `aktar-${project}-yarim.png`) });
  });
});
