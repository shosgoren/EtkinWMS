"use server";
// Cari kart eylemleri (T-428). İnce giriş: yalnız girdi doğrulama (zod) + domain komutu; yetki (`settings.manage`; Excel aktarımı `data.import`), doğrulama ve audit domain'dedir.
// Aktarım satırları yalnız bellekte taşınır (diske/loga yazılmaz, G-09). Bu dosyada DB bağlantısı açılmaz (`getAppDb` yalnız domain'e verilir).
import { headers } from "next/headers";
import { z } from "zod";
import { getAppDb } from "@wms/db";
import { PARTY_IMPORT_MAX_ROWS, importParties, listParties, saveParty, setPartyArchived } from "@wms/domain/catalog/parties";
import { createProductionGuard, limitVerifiedTenant, type ActionContext } from "../../../../lib/action-guard.ts";
import { PARTIES_PAGE_SIZE } from "./list-page.ts";

const guardedAction = createProductionGuard(() => headers());

const slugSchema = z.string().min(1).max(63);
const text = (max: number) => z.string().max(max).optional();
// Üst sınırlar yalnız kaba kötüye kullanıma karşıdır; asıl alan kuralları domain'dedir (`cleanParty`).
const fields = {
  code: text(200),
  name: text(400),
  kind: text(60),
  taxNo: text(60),
  taxOffice: text(200),
  phone: text(80),
  email: text(300),
  city: text(200),
  address: text(1000),
};
const saveSchema = z.object({ slug: slugSchema, id: z.string().uuid().optional(), expectedVersion: z.number().int().min(1).max(2_147_483_647).optional(), ...fields }).strict();
const archiveSchema = z.object({ slug: slugSchema, id: z.string().uuid(), expectedVersion: z.number().int().min(1).max(2_147_483_647), archived: z.boolean() }).strict();
const importSchema = z
  .object({ slug: slugSchema, dryRun: z.boolean(), addMissing: z.boolean().optional(), rows: z.array(z.object({ row: z.number().int().min(1).max(100_000), ...fields }).strict()).min(1).max(PARTY_IMPORT_MAX_ROWS) })
  .strict();

const moreSchema = z.object({ slug: slugSchema, q: z.string().max(100), archived: z.boolean(), after: z.string().min(1).max(2048) }).strict();

async function writeContext(slug: string, ctx: ActionContext, permission: "settings.manage" | "data.import" = "settings.manage") {
  const principal = ctx.principal;
  if (principal === null) throw new Error("unreachable: principal required");
  await limitVerifiedTenant({ db: getAppDb(), principal, tenantSlug: slug, permission }, ctx);
  return { db: getAppDb(), principal, tenantSlug: slug };
}

/** Tek cari ekle/düzenle; alan sorunu hata değil sonuçtur (`ok: false, issue`). */
export async function savePartyAction(raw: unknown) {
  return guardedAction({ schema: saveSchema }, async (input, ctx) => {
    const { slug, ...body } = input;
    const params = await writeContext(slug, ctx);
    return saveParty({ ...params, requestId: ctx.requestId }, body);
  })(raw);
}

export async function archivePartyAction(raw: unknown) {
  return guardedAction({ schema: archiveSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx);
    return setPartyArchived({ ...params, requestId: ctx.requestId }, { id: input.id, expectedVersion: input.expectedVersion, archived: input.archived });
  })(raw);
}

/** Excel'den aktarım parçası (≤ 500 satır). `dryRun`: kontrol adımı, hiçbir şey yazılmaz. */
export async function importPartiesAction(raw: unknown) {
  return guardedAction({ schema: importSchema }, async (input, ctx) => {
    const params = await writeContext(input.slug, ctx, "data.import");
    return importParties({ ...params, requestId: ctx.requestId }, { rows: input.rows, dryRun: input.dryRun, ...(input.addMissing === undefined ? {} : { addMissing: input.addMissing }) });
  })(raw);
}

/** T-1058: liste sonuna yaklaşınca sonraki 50 cari. Okuma yetkisi (`stock.view`) ve imleç doğrulaması domain okuyucusunda. */
export async function loadMorePartiesAction(raw: unknown) {
  return guardedAction({ schema: moreSchema }, async (input, ctx) => {
    const principal = ctx.principal;
    if (principal === null) throw new Error("unreachable: principal required");
    const page = await listParties({ db: getAppDb(), principal, tenantSlug: input.slug }, { q: input.q, archived: input.archived, limit: PARTIES_PAGE_SIZE, after: input.after });
    return { items: page.items, nextCursor: page.nextCursor };
  })(raw);
}
