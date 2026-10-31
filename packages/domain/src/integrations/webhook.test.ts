// T-1138: Paraşüt anlık bildirim — gövde ayrıştırma, imza doğrulama, olay anahtarı, anahtar mührü ve kademe (saf işlevler).
import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSealer } from "@wms/shared/seal";
import { CADENCE, dueFlows, registerDue } from "./webhook-register.ts";
import { WEBHOOK_BODY_MAX, matchSignature, openWebhookKey, parseWebhookBody, sealWebhookKey, signedFields, verifySignature, webhookEventKey, webhookEventSingletonKey } from "./webhook.ts";

const data = JSON.stringify({ id: "501", data: { id: "501", type: "products", attributes: { name: "Vida", updated_at: "2026-10-30T09:00:00+03:00" } } });
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const base = { company_id: "115", resource: "product", action: "update", event_date: "2026-10-30T09:00:01+03:00", data };

describe("parseWebhookBody", () => {
  it("www-url-encoded gövde: alanlar ve imza iletileri", () => {
    const raw = form(base);
    const p = parseWebhookBody(raw);
    expect(p).toMatchObject({ companyId: "115", resource: "product", action: "update", externalId: "501", eventDate: "2026-10-30T09:00:01+03:00" });
    expect(p?.signed).toEqual([data, raw]);
  });
  it("JSON gövde, `data` nesne ya da metin; çoğul kaynak adı", () => {
    expect(parseWebhookBody(JSON.stringify({ ...base, resource: "contacts", data: JSON.parse(data) }))).toMatchObject({ resource: "contact", externalId: "501" });
    expect(parseWebhookBody(JSON.stringify(base))).toMatchObject({ resource: "product", externalId: "501" });
  });
  it("kart dışı model doğrulanır ama kaynak null (iş açılmaz)", () => {
    expect(parseWebhookBody(form({ ...base, resource: "sales_invoice" }))?.resource).toBeNull();
  });
  it("olay zamanı yoksa kaydın updated_at'i, o da yoksa veri özeti", () => {
    const { event_date: _e, ...rest } = base;
    void _e;
    expect(parseWebhookBody(form(rest))?.eventDate).toBe("2026-10-30T09:00:00+03:00");
    const bare = JSON.stringify({ id: "7" });
    expect(parseWebhookBody(form({ ...rest, data: bare }))?.eventDate).toBe(createHash("sha256").update(bare).digest("hex"));
  });
  it("bozuk/eksik/yinelenen alan ve aşırı büyük gövde reddedilir", () => {
    for (const bad of [
      "",
      "{",
      "[]",
      form({ ...base, company_id: "11a" }),
      form({ ...base, company_id: "1234567890123" }),
      form({ ...base, action: "archive" }),
      form({ ...base, data: "{}" }),
      form({ ...base, data: JSON.stringify({ id: "../1" }) }),
      `${form(base)}&company_id=116`,
      "x".repeat(WEBHOOK_BODY_MAX + 1),
    ]) expect(parseWebhookBody(bad), bad.slice(0, 40)).toBeNull();
  });
});

describe("verifySignature", () => {
  const key = randomBytes(32).toString("hex");
  const hmac = createHmac("sha256", key).update(data).digest();
  it("HMAC-SHA256 onaltılık (büyük harf / sha256= öneki) ve base64; SHA256(veri+anahtar)", () => {
    expect(verifySignature(hmac.toString("hex"), [key], [data])).toBe(true);
    expect(verifySignature(`sha256=${hmac.toString("hex").toUpperCase()}`, [key], [data])).toBe(true);
    expect(verifySignature(hmac.toString("base64"), [key], [data])).toBe(true);
    expect(verifySignature(createHash("sha256").update(data + key).digest("hex"), [key], [data])).toBe(true);
  });
  it("anahtarsız özet, başka anahtar, değişmiş veri, boş/kısa imza reddedilir", () => {
    expect(verifySignature(createHash("sha256").update(data).digest("hex"), [key], [data])).toBe(false);
    expect(verifySignature(hmac.toString("hex"), [randomBytes(32).toString("hex")], [data])).toBe(false);
    expect(verifySignature(hmac.toString("hex"), [key], [data.replace("Vida", "Somun")])).toBe(false);
    expect(verifySignature(null, [key], [data])).toBe(false);
    expect(verifySignature("abc", [key], [data])).toBe(false);
    expect(verifySignature(hmac.toString("hex"), [], [data])).toBe(false);
  });
});

describe("imzalı alanlar (inceleme MINOR-1)", () => {
  const key = randomBytes(32).toString("hex");
  const raw = form(base);
  const p = parseWebhookBody(raw)!;
  it("yalnız `data` eşleşirse olay zamanı imzalı veriden, eylem yok; ham gövde eşleşirse dış alanlar", () => {
    const onData = matchSignature(createHmac("sha256", key).update(data).digest("hex"), [key], p.signed, p.rawIndex);
    expect(onData).toBe(0);
    expect(signedFields(p, onData)).toEqual({ eventDate: "2026-10-30T09:00:00+03:00", action: null });
    const onRaw = matchSignature(createHmac("sha256", key).update(raw).digest("hex"), [key], p.signed, p.rawIndex);
    expect(onRaw).toBe(p.rawIndex);
    expect(signedFields(p, onRaw)).toEqual({ eventDate: "2026-10-30T09:00:01+03:00", action: "update" });
  });
  it("yeniden tarihlenen dış event_date olay zamanını değiştirmez (yalnız data imzalıyken)", () => {
    const other = parseWebhookBody(form({ ...base, event_date: "2030-01-01T00:00:00Z", action: "delete" }))!;
    expect(signedFields(other, 0)).toEqual(signedFields(p, 0));
    const bare = JSON.stringify({ id: "7" });
    expect(parseWebhookBody(form({ ...base, data: bare }))!.dataEventDate).toBe(createHash("sha256").update(bare).digest("hex"));
  });
  it("kuyruk tekil anahtarı kayıt başına (olay zamanı içermez)", () => {
    expect(webhookEventSingletonKey("i-1", "product", "501")).toBe("integration.webhook.event.i-1.product.501");
  });
});

describe("olay anahtarı ve anahtar mührü", () => {
  it("aynı (tenant, kaynak, kimlik, zaman) aynı UUID; herhangi biri değişince farklı", () => {
    const t = "6f1c0b54-6a7d-4b5f-9a59-2f1f1f1f1f1f";
    const k = webhookEventKey(t, "product", "501", "z");
    expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(webhookEventKey(t, "product", "501", "z")).toBe(k);
    for (const other of [webhookEventKey("6f1c0b54-6a7d-4b5f-9a59-2f1f1f1f1f10", "product", "501", "z"), webhookEventKey(t, "contact", "501", "z"), webhookEventKey(t, "product", "502", "z"), webhookEventKey(t, "product", "501", "y")]) expect(other).not.toBe(k);
  });
  it("mühürlü anahtar yalnız aynı tenant'ta açılır; kutuda düz anahtar yok", () => {
    const sealer = createSealer(randomBytes(32).toString("hex"));
    const box = sealWebhookKey(sealer, "6f1c0b54-6a7d-4b5f-9a59-2f1f1f1f1f1f", "k".repeat(64));
    expect(JSON.stringify(box)).not.toContain("k".repeat(64));
    expect(openWebhookKey(sealer, "6f1c0b54-6a7d-4b5f-9a59-2f1f1f1f1f1f", box)).toBe("k".repeat(64));
    expect(openWebhookKey(sealer, "6f1c0b54-6a7d-4b5f-9a59-2f1f1f1f1f10", box)).toBeNull();
    expect(openWebhookKey(sealer, "6f1c0b54-6a7d-4b5f-9a59-2f1f1f1f1f1f", { v: 2 })).toBeNull();
  });
});

describe("kademe", () => {
  const now = Date.UTC(2026, 9, 30, 9, 0, 0);
  const ago = (ms: number) => new Date(now - ms);
  const flows = [
    { flow: "PRODUCTS" as const, direction: "PULL" as const, lastRunAt: ago(60_000) },
    { flow: "CONTACTS" as const, direction: "BOTH" as const, lastRunAt: ago(CADENCE.cardsMs) },
    { flow: "WAREHOUSES" as const, direction: "PULL" as const, lastRunAt: ago(60_000) },
    { flow: "STOCK" as const, direction: "PUSH" as const, lastRunAt: ago(1_000) },
  ];
  it("anlık bildirim açık: kart 15 dk, depo 3 dk, gönderim her tik", () => {
    expect(dueFlows(flows, true, now)).toEqual(["CONTACTS", "STOCK"]);
    expect(dueFlows([{ ...flows[2]!, lastRunAt: ago(CADENCE.warehousesMs) }], true, now)).toEqual(["WAREHOUSES"]);
    expect(dueFlows([{ flow: "PRODUCTS", direction: "PUSH", lastRunAt: ago(1_000) }], true, now)).toEqual(["PRODUCTS"]);
    expect(dueFlows([{ flow: "PRODUCTS", direction: "PULL", lastRunAt: null }], true, now)).toEqual(["PRODUCTS"]);
  });
  it("anlık bildirim kapalı/kurulamadı: bütün akışlar 30 sn kademesinde", () => {
    expect(dueFlows(flows, false, now)).toEqual(["PRODUCTS", "CONTACTS", "WAREHOUSES", "STOCK"]);
  });
  it("kayıt: hiç denenmemiş hemen; FAILED/OFF saatte bir; ACTIVE günde bir", () => {
    expect(registerDue("OFF", null, now)).toBe(true);
    expect(registerDue("FAILED", ago(CADENCE.registerRetryMs - 1), now)).toBe(false);
    expect(registerDue("FAILED", ago(CADENCE.registerRetryMs), now)).toBe(true);
    expect(registerDue("ACTIVE", ago(CADENCE.registerRetryMs), now)).toBe(false);
    expect(registerDue("ACTIVE", ago(CADENCE.registerReconcileMs), now)).toBe(true);
  });
});
