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

/** T-1139: tek bağlanma yolu yetki kodu (parola akışı yok); her çağrı sahte sunucudan yeni tek kullanımlık kod alır. */
const grant = (c: ParasutClient, code = fake.mintAuthorizationCode()) => c.authorizationCodeGrant({ clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, code, redirectUri: fake.opts.redirectUri });

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
  it("yetki kodu akışı: belge alanları, form gövdesi; yenileme yeni yenileme belirteci döndürür", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const code = fake.mintAuthorizationCode();
    const t = await grant(c, code);
    expect(t.accessToken).toBe(fake.accessToken);
    expect(t.expiresAt).toBeGreaterThan(Date.now() + 7000_000);
    const req = fake.requests[0];
    expect(req?.path).toBe("/oauth/token");
    expect(req?.contentType).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(req?.body ?? "");
    expect(Object.fromEntries(form)).toEqual({ grant_type: "authorization_code", client_id: fake.opts.clientId, client_secret: fake.opts.clientSecret, code, redirect_uri: fake.opts.redirectUri });
    const r = await c.refreshGrant({ clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, refreshToken: t.refreshToken });
    expect(r.refreshToken).not.toBe(t.refreshToken);
    // Eski yenileme belirteci artık geçmez (döner).
    await expect(c.refreshGrant({ clientId: fake.opts.clientId, clientSecret: fake.opts.clientSecret, refreshToken: t.refreshToken })).rejects.toMatchObject({ code: "AUTH_FAILED" });
    // Kod tek kullanımlık.
    await expect(grant(c, code)).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });

  it("hatalı kod AUTH_FAILED; hata iletisi sır taşımaz", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const e = (await grant(c, "yanlis-kod-xyz").catch((x: unknown) => x)) as ProviderError;
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe("AUTH_FAILED");
    const text = `${e.message} ${e.stack ?? ""} ${JSON.stringify(e)}`;
    for (const secret of ["yanlis-kod-xyz", fake.opts.clientSecret]) expect(text).not.toContain(secret);
  });

  it("T-1139: istemcide parola akışı yok; sahte sunucu da parola akışını reddeder", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    expect("passwordGrant" in c).toBe(false);
    const res = await fetch(`${fake.url}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: fake.opts.clientId, client_secret: fake.opts.clientSecret, username: "x@example.test", password: "x" }).toString() });
    expect(res.status).toBe(400);
  });

  it("şirket listesi /v4/me?include=companies", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const t = await grant(c);
    expect(await c.companies(t.accessToken)).toEqual([{ id: "115", name: fake.opts.companyName }]);
    expect(fake.requests.at(-1)?.authorization).toBe(`Bearer ${t.accessToken}`);
  });
});

describe("kaynaklar", () => {
  it("sayfalı liste (25), filtre ile arama, oluşturma", async () => {
    for (let i = 0; i < 30; i++) fake.products.push({ id: String(i + 1), attributes: { code: `K-${i}`, name: `Ürün ${i}` } });
    const c = new ParasutClient({ baseUrl: fake.url });
    const { accessToken: tok } = await grant(c);
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
    const { accessToken: tok } = await grant(c);
    await c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "2026-10-21T09:00:00.000Z", description: "Etkin WMS · SVK-1", procurementNumber: "SVK-1", contactId: "77", lines: [{ productId: "5", quantity: "3.000000" }] });
    expect(fake.shipments[0]?.body).toEqual({
      data: {
        type: "shipment_documents",
        attributes: { issue_date: "2026-10-21", shipment_date: "2026-10-21T09:00:00.000Z", inflow: false, description: "Etkin WMS · SVK-1", procurement_number: "SVK-1" },
        relationships: { contact: { data: { id: "77", type: "contacts" } }, stock_movements: { data: [{ type: "stock_movements", attributes: { quantity: 3 }, relationships: { product: { data: { id: "5", type: "products" } } } }] } },
      },
    });
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "../1", lines: [] })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("T-1135 (I-09): 6 ondalıklı miktar ve toplam JSON gövdesine float aritmetiği olmadan birebir sayı olarak gider", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const { accessToken: tok } = await grant(c);
    await c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "7", lines: [{ productId: "5", quantity: "0.000123" }, { productId: "6", quantity: "12.340000" }] });
    await c.createStockUpdate(tok, "115", [{ productId: "5", warehouseId: "9", total: "12345678901234.123456" }, { productId: "6", warehouseId: "9", total: "0.100000" }]);
    const ship = fake.requests.find((r) => r.path === "/v4/115/shipment_documents")?.body ?? "";
    const stock = fake.requests.find((r) => r.path === "/v4/115/stock_updates")?.body ?? "";
    expect(ship).toContain('"quantity":0.000123');
    expect(ship).toContain('"quantity":12.34');
    expect(stock).toContain('"new_total_inventory":12345678901234.123456');
    expect(stock).toContain('"new_total_inventory":0.1');
    expect(`${ship}${stock}`).not.toMatch(/"(quantity|new_total_inventory)":"/);
    await expect(c.createStockUpdate(tok, "115", [{ productId: "5", warehouseId: "9", total: "1e3" }])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("4xx/5xx sabit kodlara iner", async () => {
    const c = new ParasutClient({ baseUrl: fake.url });
    const { accessToken: tok } = await grant(c);
    fake.shipmentFailure = 422;
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "1", lines: [{ productId: "1", quantity: "1" }] })).rejects.toMatchObject({ code: "INVALID", status: 422, retryable: false });
    fake.shipmentFailure = 503;
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "1", lines: [{ productId: "1", quantity: "1" }] })).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
    fake.shipmentFailure = "drop";
    await expect(c.createShipmentDocument(tok, "115", { issueDate: "2026-10-21", shipmentDate: "x", description: "d", procurementNumber: "p", contactId: "1", lines: [{ productId: "1", quantity: "1" }] })).rejects.toMatchObject({ code: "NETWORK", status: null });
    fake.expireAccess();
    await expect(c.list(tok, "115", "products", 1)).rejects.toMatchObject({ code: "AUTH_FAILED", status: 401 });
  });
});

describe("hız sınırı", () => {
  it("10 saniyede en çok 10 istek (kayan pencere)", async () => {
    let now = 1_000_000;
    const slept: number[] = [];
    const c = new ParasutClient({ baseUrl: fake.url, now: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } });
    const { accessToken: tok } = await grant(c);
    for (let i = 0; i < 12; i++) await c.list(tok, "115", "products", 1);
    expect(c.requests).toBe(13);
    // 11. istekte pencere doldu: ilk istekten 10 sn geçene dek beklendi.
    expect(slept.length).toBeGreaterThanOrEqual(1);
    expect(slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10_000);
  });

  it("429 → Retry-After kadar bekleyip yeniden dener (en çok 3)", async () => {
    const slept: number[] = [];
    const c = new ParasutClient({ baseUrl: fake.url, sleep: async (ms) => void slept.push(ms) });
    const { accessToken: tok } = await grant(c);
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
    const tokens=await grant(new ParasutClient({baseUrl:fake.url}));
    fake.products.push({id:"9876",attributes:{name:"Lifecycle",unit:"adet",archived:true}});
    const c=new ParasutClient({baseUrl:fake.url});
    expect(await c.product(tokens.accessToken,fake.opts.companyId,"9876")).toMatchObject({id:"9876",type:"products",attributes:{archived:true}});
    expect(await c.product(tokens.accessToken,fake.opts.companyId,"9877")).toBeNull();
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

describe("T-1140 düzeltme gönderimi (PUT) ve depo okuma", () => {
  it("yalnız verilen alanlar gider; boş cari alanı gönderilmez; yanıt güncel kaynak; 404 / 422 sabit kod", async () => {
    fake.products.push({ id: "501", attributes: { code: "K-501", name: "Eski", unit: "Adet" } });
    fake.contacts.push({ id: "502", attributes: { name: "Cari", email: "a@b.test", account_type: "customer" } });
    fake.warehouses.push({ id: "503", attributes: { name: "Depo" } });
    const c = new ParasutClient({ baseUrl: fake.url });
    const { accessToken: tok } = await grant(c);
    const p = await c.updateProduct(tok, "115", "501", { name: "Yeni" });
    expect(p.attributes).toMatchObject({ code: "K-501", name: "Yeni", unit: "Adet" });
    expect(fake.requests.at(-1)).toMatchObject({ method: "PUT", path: "/v4/115/products/501" });
    expect(JSON.parse(fake.requests.at(-1)?.body ?? "{}")).toEqual({ data: { id: "501", type: "products", attributes: { name: "Yeni" } } });
    await c.updateContact(tok, "115", "502", { name: "Cari 2", taxNumber: null, taxOffice: null, email: null, phone: "0532 111 22 33", city: null, district: null, address: null, shortName: null });
    expect(fake.updates.at(-1)).toEqual({ kind: "contacts", id: "502", attributes: { name: "Cari 2", phone: "0532 111 22 33" } });
    expect(fake.contacts.find((x) => x.id === "502")?.attributes.email).toBe("a@b.test");
    expect((await c.updateWarehouse(tok, "115", "503", { name: "Depo 2" })).attributes.name).toBe("Depo 2");
    expect((await c.warehouse(tok, "115", "503"))?.attributes.name).toBe("Depo 2");
    expect(await c.warehouse(tok, "115", "999")).toBeNull();
    await expect(c.updateWarehouse(tok, "115", "999", { name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    fake.updateFailure = 422;
    await expect(c.updateProduct(tok, "115", "501", { name: "Z" })).rejects.toMatchObject({ code: "INVALID", status: 422 });
    await expect(c.updateProduct(tok, "115", "../1", { name: "Z" })).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});
