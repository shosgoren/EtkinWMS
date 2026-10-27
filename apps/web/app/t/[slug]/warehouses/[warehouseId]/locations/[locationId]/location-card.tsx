"use client";
// T-1082: raf yeri kartı — STANDART §3 kayıt kartı kalıbı (ürün ve depo kartıyla aynı parçalar: şerit, bilgi kutucukları, son
// hareketler). Veri sunucuda okunur (`getLocationCard`); burada yalnız gösterilir. Raftaki her ürün kendi kartını açar.
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { LICON } from "../../../../../../design/kalip-icons.ts";
import { SICON } from "../../../../../../design/standart-icons.ts";
import { Ico, KalipEkran } from "../../../../kalip/ekran.tsx";
import { approx, fmtQty } from "../../../../kalip/format.ts";
import { KalipBilgiIzgara, KalipKartSerit, KalipKayitKart, KalipSonHareketler, type KalipBilgi, type KalipEtiket, type KalipHareket, type KalipSayiKutusu, type StTon } from "../../../../kalip/kart.tsx";

export interface LocationCardView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly depth: number;
  readonly kind: "RECEIVING" | "STORAGE" | "STAGING" | "TRANSIT";
  readonly pickBlocked: boolean;
  readonly status: "ACTIVE" | "ARCHIVED";
}
export interface LocationContentView {
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemName: string;
  readonly unitCode: string;
  readonly physical: string;
  readonly reserved: string;
}
export interface LocationMoveView {
  readonly documentId: string;
  readonly kind: string;
  readonly number: string | null;
  readonly occurredAt: string;
  readonly actorName: string | null;
  readonly net: string;
  readonly items: string;
}

const KIND_TON: Readonly<Record<LocationCardView["kind"], StTon>> = { RECEIVING: "mavi", STORAGE: "camgobegi", STAGING: "turuncu", TRANSIT: "mor" };
const MOVE_VIS: Readonly<Record<string, { d: string; ton: StTon }>> = {
  STOCK_IN: { d: LICON.moveIn, ton: "yesil" },
  STOCK_OUT: { d: LICON.moveOut, ton: "turuncu" },
  STOCK_MOVE: { d: LICON.transfer, ton: "mor" },
  REVERSAL: { d: LICON.transfer, ton: "lacivert" },
  COUNT_ADJUSTMENT: { d: LICON.clip, ton: "mor" },
};
const MOVE_FALLBACK = { d: LICON.clip, ton: "gri" as StTon };

function levelKey(depth: number): "zone" | "rack" | "bin" | "deeper" {
  return depth === 0 ? "zone" : depth === 1 ? "rack" : depth === 2 ? "bin" : "deeper";
}

export function LocationCard({
  slug,
  dark,
  warehouseId,
  warehouseName,
  location,
  path,
  contents,
  contentsMore,
  moves,
}: {
  slug: string;
  dark: boolean;
  warehouseId: string;
  warehouseName: string;
  location: LocationCardView;
  path: readonly { readonly id: string; readonly code: string }[];
  contents: readonly LocationContentView[];
  contentsMore: boolean;
  moves: readonly LocationMoveView[];
}) {
  const t = useTranslations("warehouses.loc");
  const tt = useTranslations("warehouses.tree");
  const tk = useTranslations("warehouses.kind");
  const tw = useTranslations("warehouses");
  const tm = useTranslations("items.detail.k");
  const locale = useLocale();
  const s = encodeURIComponent(slug);
  const treeHref = `/t/${s}/warehouses/${encodeURIComponent(warehouseId)}`;
  const docs = `/t/${s}/stock/documents`;
  const fq = (v: string): string => fmtQty(v, locale);
  const active = location.status === "ACTIVE";
  const reservedN = contents.filter((c) => approx(c.reserved) > 0).length;

  const etiketler: KalipEtiket[] = [
    { metin: location.code, mono: true, testId: "kalip-code" },
    { metin: tt(`level.${levelKey(location.depth)}`) },
    active ? { metin: tw("status.ACTIVE"), ton: "ok" } : { metin: tw("status.ARCHIVED"), ton: "kirmizi" },
    ...(location.pickBlocked ? [{ metin: t("pickBlocked"), ton: "kirmizi" as const }] : []),
  ];
  const kutular: KalipSayiKutusu[] = [
    { key: "items", etiket: t("boxItems"), deger: contentsMore ? `${contents.length}+` : String(contents.length), d: LICON.box, ton: "camgobegi", testId: "kalip-total" },
    ...(reservedN === 0 ? [] : [{ key: "reserved", etiket: t("boxReserved"), deger: String(reservedN), d: LICON.lock, ton: "amber" as const }]),
  ];
  const bilgiler: KalipBilgi[] = [
    { key: "warehouse", etiket: t("warehouse"), deger: warehouseName, d: LICON.depo, ton: "lacivert" },
    { key: "path", etiket: t("path"), deger: path.length === 0 ? t("pathRoot") : path.map((p) => p.code).join(" › "), d: LICON.raf, ton: "camgobegi" },
    { key: "kind", etiket: t("kind"), deger: tk(location.kind), d: SICON.bilgi, ton: KIND_TON[location.kind] },
  ];

  const when = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return diff <= 0 ? tm("whenToday", { time }) : diff === 1 ? tm("whenYesterday", { time }) : tm("whenDays", { n: diff });
  };
  const hareketler: KalipHareket[] = moves.map((m) => {
    const known = Object.hasOwn(MOVE_VIS, m.kind);
    const v = known ? (MOVE_VIS[m.kind] ?? MOVE_FALLBACK) : MOVE_FALLBACK;
    const kindName = known ? tm(`kind_${m.kind}`) : tm("kind_OTHER");
    const n = approx(m.net);
    return {
      key: m.documentId,
      baslik: kindName,
      no: m.number,
      meta: [when(m.occurredAt), m.items].filter((x) => x !== "").join(" · "),
      miktar: n > 0 ? `+${fq(m.net)}` : fq(m.net),
      yon: n > 0 ? "giris" : n < 0 ? "cikis" : "yer",
      d: v.d,
      ton: v.ton,
      kisi: m.actorName,
      href: `${docs}?id=${encodeURIComponent(m.documentId)}`,
      aria: tm("moveOpen", { kind: kindName, no: m.number ?? "" }).trim(),
    };
  });

  return (
    <KalipEkran kind="detay" dark={dark} title={t("title")} icon={{ d: LICON.raf, color: "0E7C7B" }} heading={false} testId="location-card" bar={{ back: { href: treeHref, aria: t("back") } }}>
      <KalipKayitKart
        testId="location-kart"
        serit={<KalipKartSerit etiket={t("hero")} ad={location.name} d={LICON.raf} tur={active ? KIND_TON[location.kind] : "gri"} etiketler={etiketler} kutular={kutular} islemler={[]} islemEtiket={tw("k.quick")} />}
        ana={
          <>
            <KalipBilgiIzgara baslik={t("info")} bilgiler={bilgiler} kilitD={SICON.kilit} />
            <div data-testid="location-contents" className="flex min-w-0 flex-col gap-3">
              <b className="stkbas">{t("contents")}</b>
              {contents.length === 0 ? (
                <small className="stkbos" data-testid="location-contents-empty">
                  {t("contentsEmpty")}
                </small>
              ) : (
                <ul className="whl" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {contents.map((c) => (
                    <li key={c.itemId} className="whr" data-testid="location-content-row">
                      <Link href={`/t/${s}/items/${encodeURIComponent(c.itemId)}`} prefetch={false} style={{ minWidth: 0, minHeight: 44, display: "flex", flexDirection: "column", justifyContent: "center", textDecoration: "none", color: "inherit" }} aria-label={t("itemOpen", { name: c.itemName })}>
                        <b>{c.itemName}</b>
                        <small className="mono">{c.itemCode}</small>
                      </Link>
                      <span className="pill ok">
                        {fq(c.physical)} {c.unitCode}
                        {approx(c.reserved) > 0 ? ` · ${t("reservedShort", { q: fq(c.reserved) })}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {contentsMore ? <small className="stkbos">{t("contentsMore", { n: contents.length })}</small> : null}
            </div>
            <Link className="more" href={treeHref} data-testid="location-back-tree">
              <i>
                <Ico d={LICON.raf} size={20} />
              </i>
              {t("back")}
            </Link>
          </>
        }
        yan={
          <div data-testid="location-moves" className="contents">
            <KalipSonHareketler baslik={tm("moves")} tumu={{ href: docs, etiket: tm("movesAll") }} bos={t("movesNone")} hareketler={hareketler} kisiEtiket={tm("actor")} />
          </div>
        }
      />
    </KalipEkran>
  );
}
