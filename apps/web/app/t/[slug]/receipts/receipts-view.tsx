"use client";
// Beklenen teslimler (T-313; T-972 B-63 grup 2 kalıp). Liste: KalipListe kabı + teslim kartları (satır durumu, sahada kabul, kalite onayı);
// yeni teslim: KalipForm grupları (`?new=1`). Yetki kararı yalnızca gösterimdir (`document.create` / `document.approve`); eylemler sunucuda
// yeniden denetler. Anahtar yaşam döngüsü ve hata eşlemesi `receipt-form.tsx` ortak takımından (değişmedi).
// Bilinçli farklar (DESIGN-PARITY): teslim kartında iç düğmeler (kalite onayı, sahada kabul) bulunduğundan kart bağlantı değil, `.uc`
// görünümlü liste öğesidir; durum süzgeci sunucuda yok → çip yok.
// T-1119 (B-123): eski @wms/ui Banner / Button / TextField ve Tailwind kutuları kaldırıldı — bildirimler `KalipBildirim`, düğmeler `KalipDugme`,
// alanlar `KalipAlan`, ürün arama `KalipSecimAra` (sunucuda arar); formun kendi "Teslimi kaydet" düğmesi `workflow-primary` (alt çubuk çağırır).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KalipOnay } from "../kalip/pencere.tsx";
import { KalipBildirim, KalipDugme, KalipSatirKart } from "../kalip/belge.tsx";
import { LICON } from "../../../design/kalip-icons.ts";
import { kdz } from "../kalip/tokens.ts";
import { Ico, KalipBaslik, KalipEkran } from "../kalip/ekran.tsx";
import { fmtQty, sumDecimal } from "../kalip/format.ts";
import { KalipAlan, KalipGrup } from "../kalip/form.tsx";
import { KalipSecim, KalipSecimAra } from "../kalip/secim.tsx";
import { KalipBos, KalipDaha } from "../kalip/liste.tsx";
import { KalipSonsuz, useKalipDerinlik } from "../kalip/tablo.tsx";
import { searchItemsAction } from "../items/actions.ts";
import { approveQualityAction, createReceiptAction, itemUnitsAction, loadMoreReceiptsAction } from "./actions.ts";
import { ErrorNotice, LineStatus, submitWithKey, useKeyHolder, type ErrorContext, type ErrorInfo, type ReceiptView } from "./receipt-form.tsx";
import { useSonucSesi } from "../kalip/sonuc-sesi.ts";

const ICON = { d: LICON.moveIn, color: "2F7D5B" } as const;
const STATUS_ICON: Record<ReceiptView["status"], { readonly d: string; readonly color: string }> = {
  DRAFT: { d: LICON.pencil, color: "B07D0B" },
  OPEN: { d: LICON.moveIn, color: "2F5DA8" },
  CLOSED: { d: LICON.check, color: "2F7D5B" },
  CANCELLED: { d: LICON.close, color: "4E6476" },
};

export interface WarehouseOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface ReceiptsListProps {
  readonly slug: string;
  readonly dark: boolean;
  readonly receipts: readonly ReceiptView[];
  /** T-1059: sonraki sayfanın imleci (`createdKey~id`); sonraki sayfalar liste sonunda kendiliğinden gelir. */
  readonly nextCursor: string | null;
  /** Sunucudan toplam teslim sayısı (ALTIN-KURAL 15); yoksa sayfadaki satır sayısı gösterilir. */
  readonly total?: number;
  readonly canCreate: boolean;
  readonly canApprove: boolean;
  /** Paket kabulü girişi (yapılandırma + yetki sunucuda hesaplanır). */
  readonly packageHref: string | null;
  /** Yeni teslim formundan dönüşte kaydedilen belge numarası. */
  readonly created: string | null;
}

export function ReceiptsList({ slug, dark, receipts: ilkKabuller, nextCursor, total, canCreate, canApprove, packageHref, created }: ReceiptsListProps) {
  const t = useTranslations("receiving");
  const tk = useTranslations("kural");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const approveKey = useKeyHolder();
  // T-1059: kaydırınca eklenen sayfalar; sunucu yeni ilk sayfa çizince (onay sonrası yenileme dahil) sıfırlanır.
  const [ek, setEk] = useState<{ readonly bas: readonly ReceiptView[]; readonly rows: readonly ReceiptView[]; readonly next: string | null }>({ bas: ilkKabuller, rows: [], next: nextCursor });
  const guncel = ek.bas === ilkKabuller ? ek : { bas: ilkKabuller, rows: [], next: nextCursor };
  if (guncel !== ek) setEk(guncel);
  const receipts = useMemo(() => {
    const ilk = new Set(ilkKabuller.map((r) => r.id));
    return [...ilkKabuller, ...guncel.rows.filter((r) => !ilk.has(r.id))];
  }, [ilkKabuller, guncel.rows]);
  const sonraki = guncel.next;
  const dahaYukle = useCallback(async (): Promise<boolean> => {
    if (sonraki === null) return true;
    const r = await loadMoreReceiptsAction({ slug, after: sonraki });
    if (!r.ok) return false;
    setEk((o) => (o.bas !== ilkKabuller ? o : { bas: o.bas, rows: [...o.rows, ...r.data.items], next: r.data.next }));
    return true;
  }, [sonraki, slug, ilkKabuller]);
  useKalipDerinlik(receipts.length, sonraki !== null, dahaYukle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [confirm, setConfirm] = useState<ReceiptView | null>(null);
  const [approved, setApproved] = useState<string | null>(null);
  // T-436 (ALTIN-KURAL 5): onay / oluşturma başarısı ve hata sesli.
  useSonucSesi({ hata: error, tamam: approved ?? created });
  const home = `/t/${encodeURIComponent(slug)}`;
  const base = `${home}/receipts`;
  const field = `${home}/field/receive`;
  const c = (hex: string): string => kdz("dzl", hex);

  async function approve(r: ReceiptView) {
    setBusy(true);
    const out = await submitWithKey(approveKey, (clientKey) => approveQualityAction({ slug, clientKey, receiptId: r.id }));
    setBusy(false);
    setConfirm(null);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setError(null);
    setApproved(r.number);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <KalipEkran
        kind="liste"
        dark={dark}
        title={t("title")}
        icon={ICON}
        testId="receipts"
        bar={{ back: { href: home }, main: { label: t("k.newShort"), aria: t("form.title"), d: LICON.plus, href: `${base}?new=1`, disabled: !canCreate, testId: "receipts-new" } }}
      >
        <p className="sr">{t("intro")}</p>
        {created === null ? null : <KalipBildirim tur="tamam" title={t("form.created", { number: created })} />}
        {approved === null ? null : <KalipBildirim tur="tamam" title={t("quality.done", { number: approved })} />}
        {error === null ? null : <ErrorNotice error={error} context="approve" />}
        {packageHref === null ? null : (
          <KalipDaha href={packageHref} iconD={LICON.koli} iconColor="9A5B2E" testId="receipts-packages">
            {t("packageEntry")}
          </KalipDaha>
        )}
        {canCreate ? null : (
          <p className="sr" data-testid="create-locked">
            {t("form.locked")}
          </p>
        )}
        {receipts.length === 0 && sonraki === null ? (
          <KalipBos
            title={t("list.empty")}
            hint={canCreate ? t("k.emptyHint") : t("form.locked")}
            iconD={LICON.moveIn}
            action={canCreate ? { label: t("form.title"), href: `${base}?new=1`, kind: "add" } : { label: tk("home"), href: home, kind: "go" }}
          />
        ) : (
          <>
            <KalipBaslik title={t("list.title")} hint={tk("total", { n: total ?? receipts.length })} />
            <div className="ulist" role="list" aria-label={t("list.title")} data-testid="receipt-list">
              {receipts.map((r, i) => {
                const open = fmtQty(sumDecimal(r.lines.map((l) => l.open)), locale);
                const si = STATUS_ICON[r.status];
                return (
                  <div key={r.id} role="listitem" className="uc" style={{ animationDelay: `${i * 30}ms`, alignItems: "start" }} data-testid="receipt-row" data-receipt-id={r.id}>
                    <span className="uic" style={{ background: c(si.color) }}>
                      <Ico d={si.d} size={26} />
                    </span>
                    <span className="ut" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <b>{r.number}</b>
                      {r.supplierRef === null ? null : <small className="mono">{t("list.supplier", { ref: r.supplierRef })}</small>}
                      <ul className="ksatirlar">
                        {r.lines.map((l) => (
                          <li key={l.id}>
                            <b>
                              {l.itemName} <small>· {l.unitName}</small>
                            </b>
                            <LineStatus expected={l.expected} received={l.received} damaged={l.damaged} open={l.open} />
                          </li>
                        ))}
                      </ul>
                      <span className="kdugler">
                        {r.status === "OPEN" ? (
                          <Link href={`${field}?receipt=${encodeURIComponent(r.id)}`} className="kdug ana">
                            <Ico d={LICON.moveIn} size={20} />
                            <span>{t("list.receiveInField")}</span>
                          </Link>
                        ) : null}
                        {canApprove ? (
                          <KalipDugme d={LICON.check} disabled={busy} onClick={() => setConfirm(r)}>
                            {t("quality.approve")}
                          </KalipDugme>
                        ) : (
                          <small className="um" style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="quality-locked">
                            <Ico d={LICON.lock} size={14} />
                            {t("quality.locked")}
                          </small>
                        )}
                      </span>
                    </span>
                    <span className="qb">
                      <b>{open}</b>
                      <small data-status={r.status}>{t(`status.${r.status}`)}</small>
                    </span>
                  </div>
                );
              })}
              <KalipSonsuz devam={sonraki !== null} yukle={dahaYukle} metin={tk("total", { n: total ?? receipts.length })} testId="receipts-sonsuz" />
            </div>
          </>
        )}
      </KalipEkran>
      <KalipOnay
        open={confirm !== null}
        title={t("quality.confirmTitle")}
        description={t("quality.confirmBody", { number: confirm?.number ?? "" })}
        confirmLabel={t("quality.approve")}
        cancelLabel={t("cancel")}
        variant="primary"
        loading={busy}
        onConfirm={() => confirm !== null && void approve(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

interface DraftLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly quantity: string;
}
interface Found {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}
interface UnitOption {
  readonly unitId: string;
  readonly unitCode: string;
  readonly unitName: string;
}

/** Yeni teslim formu (KalipForm grupları). Başarıda listeye döner; liste kaydedilen numarayı gösterir. */
export function ReceiptNewForm({ slug, warehouses }: { slug: string; warehouses: readonly WarehouseOption[] }) {
  const t = useTranslations("receiving");
  const router = useRouter();
  const createKey = useKeyHolder();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [supplierRef, setSupplierRef] = useState("");
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [picked, setPicked] = useState<(Found & { units: readonly UnitOption[] }) | null>(null);
  const [unitId, setUnitId] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ info: ErrorInfo; ctx: ErrorContext } | null>(null);
  useSonucSesi({ hata: error });
  const changed = (): void => createKey.contentChanged();
  // T-990: React durumundaki seçim/satırlar çıkış korumasına `data-dirty` ile bildirilir (FormEkran alan olaylarını ayrıca karşılaştırır).
  const dirty = lines.length > 0 || picked !== null || warehouseId !== (warehouses[0]?.id ?? "");

  // T-1119: ürün arama sunucuda (ortak seçim sayfası `KalipSecimAra`); hata listeyi boş bırakır.
  async function search(q: string): Promise<readonly Found[]> {
    const r = await searchItemsAction({ slug, q, limit: 10 });
    return r.ok ? r.data.items : [];
  }
  async function pick(f: Found) {
    try {
      const r = await itemUnitsAction({ slug, itemId: f.id });
      if (!r.ok) {
        setError({ info: { code: r.error.code, detail: r.error.detail, requestId: r.error.requestId }, ctx: "scan" });
        return;
      }
      setPicked({ ...f, units: r.data.units });
      setUnitId(r.data.units[0]?.unitId ?? "");
      setError(null);
    } catch {
      setError({ info: { code: "NETWORK" }, ctx: "scan" });
    }
  }
  function addLine() {
    const unit = picked?.units.find((u) => u.unitId === unitId);
    if (picked === null || unit === undefined || !/^[1-9][0-9]{0,8}$/.test(qty)) return;
    changed();
    setLines((l) => [...l, { itemId: picked.id, itemName: picked.name, unitId: unit.unitId, unitName: unit.unitName || unit.unitCode, quantity: qty }]);
    setPicked(null);
    setQty("");
  }
  async function submit() {
    if (busy || lines.length === 0 || warehouseId === "") return;
    setBusy(true);
    setError(null);
    const out = await submitWithKey(createKey, (clientKey) =>
      createReceiptAction({
        slug,
        clientKey,
        warehouseId,
        ...(supplierRef.trim() === "" ? {} : { supplierRef: supplierRef.trim() }),
        lines: lines.map((l) => ({ itemId: l.itemId, unitId: l.unitId, expectedQuantity: l.quantity })),
      }),
    );
    if (!out.ok) {
      setBusy(false);
      setError({ info: out.error, ctx: "create" });
      return;
    }
    router.push(`/t/${encodeURIComponent(slug)}/receipts?${new URLSearchParams({ created: out.data.number }).toString()}`);
    router.refresh();
  }

  const wh = warehouses.find((w) => w.id === warehouseId);
  return (
    <form
      className="workflow-form kform-ic"
      data-dirty={dirty ? "true" : "false"}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <small className="khint">{t("intro")}</small>
      {error === null ? null : <ErrorNotice error={error.info} context={error.ctx} />}
      <KalipGrup title={`1. ${t("k.groupSource")}`} sub={wh === undefined ? undefined : `${wh.code} · ${wh.name}`} d={LICON.depo} color="30475A">
        {warehouses.length > 1 ? (
          <KalipSecim
            name="warehouseId"
            label={t("form.warehouse")}
            color="30475A"
            icon={{ d: LICON.depo, color: "30475A" }}
            value={warehouseId}
            options={warehouses.map((w) => ({ id: w.id, label: `${w.code} · ${w.name}`, d: LICON.depo }))}
            onPick={(id) => {
              changed();
              setWarehouseId(id);
            }}
          />
        ) : null}
        <KalipAlan
          label={t("form.supplierRef")}
          hint={t("form.supplierRefHint")}
          name="supplierRef"
          value={supplierRef}
          maxLength={100}
          autoComplete="off"
          onChange={(e) => {
            changed();
            setSupplierRef(e.target.value);
          }}
        />
      </KalipGrup>
      <KalipGrup title={`2. ${t("form.lines")}`} sub={String(lines.length)} d={LICON.box} color="2F5DA8">
        {lines.length === 0 ? null : (
          <ul aria-label={t("form.lines")} className="ksatirlar" data-testid="draft-lines">
            {lines.map((l, i) => (
              <li key={`${l.itemId}-${i}`} className="ksatir">
                <b>
                  {l.itemName} · {l.quantity} {l.unitName}
                </b>
                <button
                  type="button"
                  className="ksatk-x"
                  aria-label={t("form.removeLine", { name: l.itemName })}
                  title={t("form.remove")}
                  onClick={() => {
                    changed();
                    setLines((x) => x.filter((_, j) => j !== i));
                  }}
                >
                  <Ico d={LICON.trash} size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <KalipSatirKart title={t("form.addLine")}>
          <KalipSecimAra<Found>
            label={t("form.item")}
            hint={t("form.itemHint")}
            value={picked}
            icon={{ d: LICON.box, color: "2F5DA8" }}
            toOption={(f) => ({ id: f.id, label: f.name, sub: f.code, keys: [f.code], d: LICON.box, color: "2F5DA8" })}
            search={search}
            onPick={(f) => void pick(f)}
            testId="receipt-item"
          />
          {picked === null ? null : (
            <>
              <KalipSecim
                name="unitId"
                label={t("form.unit")}
                color="2F5DA8"
                value={unitId}
                options={picked.units.map((u) => ({ id: u.unitId, label: u.unitName || u.unitCode }))}
                onPick={setUnitId}
              />
              <KalipAlan label={t("form.expected")} inputMode="numeric" pattern="[0-9]*" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 9))} />
              <KalipDugme d={LICON.plus} onClick={addLine} disabled={!/^[1-9][0-9]{0,8}$/.test(qty)}>
                {t("form.addLine")}
              </KalipDugme>
            </>
          )}
        </KalipSatirKart>
      </KalipGrup>
      <KalipDugme tur="ana" type="submit" className="workflow-primary" d={LICON.check} busy={busy} disabled={busy || lines.length === 0 || warehouseId === ""}>
        {t("form.save")}
      </KalipDugme>
    </form>
  );
}
