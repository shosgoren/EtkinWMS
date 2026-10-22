// T-1002 (B-62): Etkin — duyulan metin → yanıt (sunucu). Yalnız okuma: kiracı listeleri ve salt okuma sonuçları `runTenantQuery` ile
// (RLS + tenant süzgeci + depo kapsamı). Yazma niyetinde yalnız taslak döner; kayıt istemcinin Onayla'sıyla mevcut eylemlerden yapılır.
import { listMyTasks, listTasks, type TaskKind, type TaskRow } from "../operations/tasks.ts";
import { sumItemsStock } from "../stock/item-card.ts";
import { decide, decideLocation, fold, parseCommand, resolveWrite, type ReadRow, type TaskKindHint, type VoiceAnswer } from "@wms/shared/voice";
import { describeTaskRefs, loadVoiceCatalog, locationContents, type VoiceParams } from "./sorgu.ts";

const enc = encodeURIComponent;

function taskKind(h: TaskKindHint | undefined): TaskKind | undefined {
  return h === undefined ? undefined : h;
}

async function taskRows(params: VoiceParams, items: readonly TaskRow[]): Promise<ReadRow[]> {
  const refs = await describeTaskRefs(
    params,
    items.flatMap((t) => (t.itemId === null ? [] : [t.itemId])),
    items.flatMap((t) => (t.locationId === null ? [] : [t.locationId])),
  );
  return items.map((t) => ({
    icon: "task" as const,
    title: `${t.kind}|${t.itemId === null ? "" : (refs.items.get(t.itemId) ?? "")}`,
    meta: [t.locationId === null ? "" : (refs.locations.get(t.locationId) ?? ""), t.quantity ?? "", t.status].join("|"),
    href: `/tasks?q=${enc(t.id.slice(0, 8))}`,
  }));
}

/** `text`: konuşma tanımanın verdiği cümle (en çok 500 karakter). */
export async function answerVoiceCommand(params: VoiceParams, text: string): Promise<VoiceAnswer> {
  const intent = parseCommand(text.slice(0, 500));
  switch (intent.kind) {
    case "confirm":
      return { type: "confirm" };
    case "fix":
      return { type: "fix" };
    case "receive":
    case "issue":
    case "transfer":
    case "count": {
      const cat = await loadVoiceCatalog(params, { items: intent.kind !== "count", locations: true, warehouses: intent.kind === "transfer" });
      return resolveWrite(intent, cat);
    }
    case "whatAt": {
      const cat = await loadVoiceCatalog(params, { locations: true });
      const m = decideLocation(intent.at, cat.locations);
      if (m.kind === "none") return { type: "read", title: intent.at.toUpperCase(), icon: "loc", rows: [], total: 0, href: "/stock", empty: "loc" };
      if (m.kind === "many") {
        return {
          type: "read",
          title: intent.at.toUpperCase(),
          icon: "loc",
          rows: m.list.map((l) => ({ icon: "loc" as const, title: l.code, meta: l.warehouseName, href: `/stock?q=${enc(l.code)}` })),
          total: m.list.length,
          href: "/stock",
        };
      }
      const r = await locationContents(params, m.c.id);
      return {
        type: "read",
        title: m.c.code,
        icon: "loc",
        rows: r.rows.map((row) => ({ icon: "item" as const, title: row.name, meta: `${row.quantity}|${row.unitCode}|${row.code}`, href: `/items?q=${enc(row.code)}` })),
        total: r.total,
        href: `/stock?q=${enc(m.c.code)}`,
        ...(r.total === 0 ? { empty: "items" } : {}),
      };
    }
    case "howMany": {
      const cat = await loadVoiceCatalog(params, { items: true });
      const m = decide(intent.item, cat.items);
      if (m.kind === "none") return { type: "read", title: intent.item, icon: "item", rows: [], total: 0, href: `/items?q=${enc(intent.item)}`, empty: "item" };
      const list = m.kind === "one" ? [m.c] : m.list;
      const sums = new Map((await sumItemsStock(params, list.map((c) => c.id))).map((s) => [s.itemId, s.have]));
      return {
        type: "read",
        title: m.kind === "one" ? m.c.name : intent.item,
        icon: "item",
        rows: list.map((c) => ({ icon: "item" as const, title: c.name, meta: `${sums.get(c.id) ?? "0"}|${c.unitCode}|${c.code}`, href: `/items?q=${enc(c.code)}` })),
        total: list.length,
        href: `/items?q=${enc(m.kind === "one" ? m.c.code : intent.item)}`,
      };
    }
    case "tasks": {
      const kind = taskKind(intent.taskKind);
      if (intent.person === undefined) {
        const page = await listMyTasks(params, { limit: 5, withTotal: true, ...(kind === undefined ? {} : { kind }) });
        return { type: "read", title: "", icon: "task", rows: await taskRows(params, page.items), total: page.total ?? page.items.length, href: "/field/tasks", ...(page.items.length === 0 ? { empty: "tasks" } : {}) };
      }
      const cat = await loadVoiceCatalog(params, { people: true });
      const m = decide(intent.person, cat.people);
      if (m.kind !== "one") {
        return {
          type: "read",
          title: intent.person,
          icon: "task",
          rows: (m.kind === "many" ? m.list : []).map((p) => ({ icon: "task" as const, title: p.name, meta: "", href: `/tasks?q=${enc(p.name)}&status=ASSIGNED` })),
          total: m.kind === "many" ? m.list.length : 0,
          href: `/tasks?q=${enc(intent.person)}`,
          ...(m.kind === "none" ? { empty: "person" } : {}),
        };
      }
      const page = await listTasks(params, { q: m.c.name.slice(0, 100), status: "ASSIGNED", limit: 5, withTotal: true, ...(kind === undefined ? {} : { kind }) });
      return {
        type: "read",
        title: m.c.name,
        icon: "task",
        rows: await taskRows(params, page.items),
        total: page.total ?? page.items.length,
        href: `/tasks?q=${enc(m.c.name)}&status=ASSIGNED`,
        ...(page.items.length === 0 ? { empty: "tasks" } : {}),
      };
    }
    case "task":
      return { type: "nav", href: `/tasks?q=${enc(intent.no)}`, what: "task" };
    case "assign": {
      const kind = taskKind(intent.taskKind);
      return { type: "nav", href: `/tasks?status=OPEN${kind === undefined ? "" : `&kind=${kind}`}`, what: "assign" };
    }
    case "ship": {
      if (intent.orderNo !== undefined) {
        const cat = await loadVoiceCatalog(params, { orders: true });
        const no = intent.orderNo;
        const hit = cat.orders.filter((o) => o.code.replace(/\D/g, "").replace(/^0+/, "") === no.replace(/^0+/, ""));
        return hit.length === 1 ? { type: "nav", href: `/shipping?id=${enc(hit[0]!.id)}`, what: "order" } : { type: "nav", href: `/shipping?q=${enc(no)}`, what: "orders" };
      }
      if (intent.party !== undefined) {
        const cat = await loadVoiceCatalog(params, { parties: true });
        const m = decide(intent.party, cat.parties);
        return { type: "nav", href: `/shipping?q=${enc(m.kind === "one" ? m.c.name : intent.party)}`, what: "orders" };
      }
      return { type: "nav", href: "/shipping", what: "orders" };
    }
    case "label": {
      const cat = await loadVoiceCatalog(params, { items: intent.item !== undefined });
      const m = intent.item === undefined ? null : decide(intent.item, cat.items);
      const copies = intent.qty !== undefined && /^\d{1,3}$/.test(intent.qty) ? `&copies=${intent.qty}` : "";
      return { type: "nav", href: m?.kind === "one" ? `/labels?item=${enc(m.c.id)}${copies}` : "/labels", what: "labels" };
    }
    case "open": {
      const t = fold(intent.target);
      if (/sevkiyat|siparis|sevk/.test(t)) {
        const name = t.replace(/\b(sevkiyat|siparis)\w*/g, "").trim();
        if (name !== "") {
          const cat = await loadVoiceCatalog(params, { parties: true });
          const m = decide(name, cat.parties);
          if (m.kind === "one") return { type: "nav", href: `/shipping?q=${enc(m.c.name)}`, what: "orders" };
        }
        return { type: "nav", href: "/shipping", what: "orders" };
      }
      if (/kritik|eksik|azalan/.test(t)) return { type: "nav", href: "/stock", what: "stock" };
      const cat = await loadVoiceCatalog(params, { parties: true, items: true });
      const party = decide(intent.target, cat.parties);
      if (party.kind === "one") return { type: "nav", href: `/parties?q=${enc(party.c.name)}`, what: "party" };
      const item = decide(intent.target, cat.items);
      if (item.kind === "one") return { type: "nav", href: `/items?q=${enc(item.c.code)}`, what: "item" };
      return { type: "open", target: intent.target };
    }
    default:
      return { type: "unknown" };
  }
}
