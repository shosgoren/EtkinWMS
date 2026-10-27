// T-991: Paraşüt istemcisi — sahte HTTP sunucusuna karşı (gerçek ağ yok). Belge şekilleri, hız sınırı, 429, sır sızmaması, SSRF kuralı.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeParasut, type FakeParasut } from "../../../../tests/integration/fixtures/fake-parasut.ts";
import { DIRECTIONS, FLOWS, defaultDirection, flowSupported, supportedDirections } from "./catalog.ts";
import { PARASUT_BASE_URL, ParasutClient, ProviderError, resolveParasutBaseUrl } from "./parasut.ts";

let fake: FakeParasut;
beforeEach(async () => {
  fake = await startFakeParasut();
});
afterEach(async () => {
  await fake.close();
});

const creds = () => ({ clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, username: fake.opts.username, password: fake.opts.password });

describe("resolveParasutBaseUrl (SSRF)", () => {
  it("varsayılan sabit Paraşüt adresi", () => {
    expect(resolveParasutBaseUrl({})).toBe(PARASUT_BASE_URL);
    expect(resolveParasutBaseUrl({ PARASUT_BASE_URL: "  " })).toBe(PARASUT_BASE_URL);
  });
  it("yalnız geri döngü adresi kabul edilir", () => {
    expect(resolveParasutBaseUrl({ PARASUT_BASE_URL: "http://127.0.0.1:4010" })).toBe("http://127.0.0.1:4010");
    expect(resolveParasutBaseUrl({ PARASUT_BASE_URL: "http://localhost:4010/" })).toBe("http://localhost:4010");
    for (const bad of ["https://evil.example", "http://10.0.0.5", "http://169.254.169.254", "http://127.0.0.1.nip.io", "file:///etc/passwd", "http://u:p@127.0.0.1:1", "http://127.0.0.1:1/v4", "nope"]) {
      expect(() => resolveParasutBaseUrl({ PARASUT_BASE_URL: bad }), bad).toThrow(ProviderError);
    }
  });
  it("şirket numarası yalnız rakam; yol enjeksiyonu reddedilir", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    for (const bad of ["../me", "115/../x", "", "1a", "123456789012345"]) await expect(c.list("t", bad, "products", 1)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("OAuth", () => {
  it("parola akışı: belge alanları, form gövdesi; yenileme yeni yenileme belirteci döndürür", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const t = await c.passwordGrant(creds());
    expect(t.accessToken).toBe(fake.accessToken);
    expect(t.expiresAt).toBeGreaterThan(Date.now() + 7000_000);
    const req = fake.requests[0];
    expect(req?.path).toBe("/oauth/token");
    expect(req?.contentType).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(req?.body ?? "");
    expect(Object.fromEntries(form)).toEqual({ grant_type: "password", client_id: fake.opts.clientId, client_secret: fake.opts.clientSecret, username: fake.opts.username, password: fake.opts.password, redirect_uri: "urn:ietf:wg:oauth:2.0:oob" });
    const r = await c.refreshGrant({ clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, refreshToken: t.refreshToken });
    expect(r.refreshToken).not.toBe(t.refreshToken);
    // Eski yenileme belirteci artık geçmez (döner).
    await expect(c.refreshGrant({ clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, refreshToken: t.refreshToken })).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("hatalı bilgi AUTH_FAILED; hata iletisi sır taşımaz", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const e = (await c.passwordGrant({ ...creds(), password: "yanlis-parola-xyz" }).catch((x: unknown) => x)) as ProviderError;
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe("AUTH_FAILED");
    const text = `${e.message} ${e.stack ?? ""} ${JSON.stringify(e)}`;
    for (const secret of ["yanlis-parola-xyz", fake.opts.clientSecret, fake.opts.username]) expect(text).not.toContain(secret);
  });

  it("şirket listesi /v4/me?include=companies", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const t = await c.passwordGrant(creds());
    expect(await c.companies(t.accessToken)).toEqual([{ id: "115", name: fake.opts.companyName }]);
    expect(fake.requests.at(-1)?.authorization).toBe(`Bearer ${t.accessToken}`);
  });
});

describe("kaynaklar", () => {
  it("sayfalı liste (25), filtre ile arama, oluşturma", async () => {
    for (let i = 0; i < 30; i++) fake.products.push({ id: String(i + 1), attributes: { code: `K-${i}`, name: `Ürün ${i}` } });
    const c = new ParasutClient({ baseUrl: fake.url });
    const { accessToken: tok } = await c.passwordGrant(creds());
    const p1 = await c.list(tok, "115", "products", 1);
    expect(p1.items).toHaveLength(25);
    expect(p1.totalPages).toBe(2);
    expect(fake.requests.at(-1)?.path).toContain("page%5Bsize%5D=25");
    expect((await c.list(tok, "115", "products", 2)).items).toHaveLength(5);
    expect((await c.findProductByCode(tok, "115", "K-7"))?.id).toBe("8");
    expect(await c.findProductByCode(tok, "115", "YOK")).toBeNull();
    const id = await c.createProduct(tok, "115", { code: "YENI", name: "Yeni ürün", unit: "Adet" });
    expect(fake.products.at(-1)).toEqual({ id, attributes: { code: "YENI", name: "Yeni ürün", unit: "Adet", inventory_tracking: true } });
  });

  it("irsaliye: inflow false, cari + stok hareketleri (ürün + miktar)", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const { accessToken: tok } = await c.passwordGrant(creds());
    await c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "2026-10-21T09:00:00.000Z", description: "Etkin WMS · SVK-1", procurementNumber: "SVK-1", contactId: "77", lines: [{ productId: "5", quantity: 3 }] });
    expect(fake.shipments[0]?.body).toEqual({
      data: {
        type: "shipment_documents",
        attributes: { issue_date: "2026-10-21", shipment_date: "2026-10-21T09:00:00.000Z", inflow: false, description: "Etkin WMS · SVK-1", procurement_number: "SVK-1" },
        relationships: { contact: { data: { id: "77", type: "contacts" } }, stock_movements: { data: [{ type: "stock_movements", attributes: { quantity: 3 }, relationships: { product: { data: { id: "5", type: "products" } } } }] } },
      },
    });
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "../1", lines: [] })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("4xx/5xx sabit kodlara iner", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const { accessToken: tok } = await c.passwordGrant(creds());
    fake.shipmentFailure = 422;
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "1", lines: [{ productId: "1", quantity: 1 }] })).rejects.toMatchObject({ code: "INVALID", status: 422, retryable: false });
    fake.shipmentFailure = 503;
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "1", lines: [{ productId: "1", quantity: 1 }] })).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
    fake.shipmentFailure = "drop";
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "1", lines: [{ productId: "1", quantity: 1 }] })).rejects.toMatchObject({ code: "NETWORK", status: null });
    fake.expireAccess();
    await expect(c.list(tok, "115", "products", 1)).rejects.toMatchObject({ code: "AUTH_FAILED", status: 401 });
  });
});

describe("hız sınırı", () => {
  it("10 saniyede en çok 10 istek (kayan pencere)", async () => {
    let now = 1_000_000;
    const slept: number[] = [];
    const c = new ParasutClient({ baseUrl: fake.url, now: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } });
    const { accessToken: tok } = await c.passwordGrant(creds());
    for (let i = 0; i < 12; i++) await c.list(tok, "115", "products", 1);
    expect(c.requests).toBe(13);
    // 11. istekte pencere doldu: ilk istekten 10 sn geçene dek beklendi.
    expect(slept.length).toBeGreaterThanOrEqual(1);
    expect(slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10_000);
  });

  it("429 → Retry-After kadar bekleyip yeniden dener (en çok 3)", async () => {
    const slept: number[] = [];
    const c = new ParasutClient({ baseUrl: fake.url, sleep: async (ms) => void slept.push(ms) });
    const { accessToken: tok } = await c.passwordGrant(creds());
    fake.rateLimitNext = 2;
    expect((await c.list(tok, "115", "products", 1)).items).toEqual([]);
    expect(slept).toEqual([1000, 1000]);
    fake.rateLimitNext = 10;
    await expect(c.list(tok, "115", "products", 1)).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });
});

describe("akış kataloğu (sağlayıcıdan bağımsız)", () => {
  it("Paraşüt: sipariş yok, irsaliye ve stok yalnız Etkin -> ERP; varsayılanlar kullanıcı kararı", () => {
    expect(flowSupported("PARASUT", "SALES_ORDERS")).toBe(false);
    expect(supportedDirections("PARASUT", "SHIPMENTS")).toEqual(["PUSH"]);
    expect(supportedDirections("PARASUT", "STOCK")).toEqual(["PUSH"]);
    expect(supportedDirections("PARASUT", "PRODUCTS")).toEqual([...DIRECTIONS]);
    expect(Object.fromEntries(FLOWS.map((f) => [f, defaultDirection("PARASUT", f)]))).toEqual({ PRODUCTS: "PULL", CONTACTS: "PULL", WAREHOUSES: "PULL", SALES_ORDERS: "PULL", SHIPMENTS: "PUSH", STOCK: "PUSH" });
  });
  it("Logo: ürün bilgisi bekleniyor — hiçbir akış yok", () => {
    for (const f of FLOWS) expect(flowSupported("LOGO", f)).toBe(false);
  });
  it("hiçbir sağlayıcıda stok ERP'den Etkin'e akmaz (I-04)", () => {
    for (const p of ["PARASUT", "LOGO"] as const) {
      expect(supportedDirections(p, "STOCK").some((d) => d !== "PUSH")).toBe(false);
      expect(supportedDirections(p, "SHIPMENTS").some((d) => d !== "PUSH")).toBe(false);
    }
  });
});


describe("single product lifecycle evidence", () => {
  it("reads the exact company-scoped product and preserves archive evidence", async () => {
    const grant=await new ParasutClient({baseUrl:fake.url}).passwordGrant(creds());
    fake.products.push({id:"9876",attributes:{name:"Lifecycle",unit:"adet",archived:true}});
    const c=new ParasutClient({baseUrl:fake.url});
    expect(await c.product(grant.accessToken,fake.opts.companyId,"9876")).toMatchObject({id:"9876",type:"products",attributes:{archived:true}});
    expect(await c.product(grant.accessToken,fake.opts.companyId,"9877")).toBeNull();
  });
  it.each([401,403,422,500])("status %s is an error, never deletion evidence", async status => {
    const c=new ParasutClient({fetch:async()=>new Response("{}",{status})});
    await expect(c.product("synthetic", "123", "9876")).rejects.toBeInstanceOf(ProviderError);
  });
  it.each([{id:"9877",type:"products"},{id:"9876",type:"contacts"}])("mismatched resource cannot authorize lifecycle changes",async data=>{
    const c=new ParasutClient({fetch:async()=>new Response(JSON.stringify({data:{...data,attributes:{},relationships:{}}}),{status:200})});
    await expect(c.product("synthetic","123","9876")).rejects.toBeInstanceOf(ProviderError);
  });
});
