// T-1043: masaüstü kurulum QR'ı → `/help/indir/<uygulama>` → telefonun mağazası.
import { describe, expect, it } from "vitest";
import { MAGAZA, dogrulamaUygulamasiMi, magazaAdresi } from "./dogrulama-magaza.ts";
import { GET } from "./help/indir/[app]/route.ts";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const call = (app: string, ua: string): Promise<Response> =>
  GET(new Request(`https://wms.example.test/help/indir/${app}`, { headers: { "user-agent": ua } }), { params: Promise.resolve({ app }) });

describe("doğrulama uygulaması mağaza yönlendirmesi", () => {
  it("iPhone ve iPad App Store'a, Android ve bilinmeyen Google Play'e", () => {
    expect(magazaAdresi("google", IPHONE)).toBe(MAGAZA.google.ios);
    expect(magazaAdresi("microsoft", IPAD)).toBe(MAGAZA.microsoft.ios);
    expect(magazaAdresi("google", ANDROID)).toBe(MAGAZA.google.android);
    expect(magazaAdresi("microsoft", MAC)).toBe(MAGAZA.microsoft.android);
    expect(magazaAdresi("google", "")).toBe(MAGAZA.google.android);
  });

  it("yalnız tanımlı uygulamalar (prototip adları dahil başka ad yok)", () => {
    expect(dogrulamaUygulamasiMi("google")).toBe(true);
    expect(dogrulamaUygulamasiMi("microsoft")).toBe(true);
    expect(dogrulamaUygulamasiMi("toString")).toBe(false);
    expect(dogrulamaUygulamasiMi("https://evil.example")).toBe(false);
  });

  it("/help/indir/<uygulama> sabit mağaza adresine 302 verir; bilinmeyen ad 404 (açık yönlendirme yok)", async () => {
    const ios = await call("google", IPHONE);
    expect(ios.status).toBe(302);
    expect(ios.headers.get("location")).toBe(MAGAZA.google.ios);
    expect(ios.headers.get("cache-control")).toBe("no-store");
    const android = await call("microsoft", ANDROID);
    expect(android.headers.get("location")).toBe(MAGAZA.microsoft.android);
    expect((await call("evil", IPHONE)).status).toBe(404);
    expect((await call("__proto__", IPHONE)).status).toBe(404);
  });
});
