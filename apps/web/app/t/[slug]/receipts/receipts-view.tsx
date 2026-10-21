"use client";
// Beklenen teslimler (T-313; T-972 B-63 grup 2 kalıp). Liste: KalipListe kabı + teslim kartları (satır durumu, sahada kabul, kalite onayı);
// yeni teslim: KalipForm grupları (`?new=1`). Yetki kararı yalnızca gösterimdir (`document.create` / `document.approve`); eylemler sunucuda
// yeniden denetler. Anahtar yaşam döngüsü ve hata eşlemesi `receipt-form.tsx` ortak takımından (değişmedi).
// Bilinçli farklar (DESIGN-PARITY): teslim kartında iç düğmeler (kalite onayı, sahada kabul) bulunduğundan kart bağlantı değil, `.uc`
// görünümlü liste öğesidir; durum süzgeci sunucuda yok → çip yok.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banner, Button, TextField } from "@wms/ui";
import { KalipOnay } from "../kalip/pencere.tsx";
import { LICON } from "../../../design/kalip-icons.ts";
import { kdz } from "../kalip/tokens.ts";
import { Ico, KalipBaslik, KalipEkran } from "../kalip/ekran.tsx";
import { fmtQty, sumDecimal } from "../kalip/format.ts";
import { KalipGrup } from "../kalip/form.tsx";
import { KalipBos, KalipDaha } from "../kalip/liste.tsx";
import { searchItemsAction } from "../items/actions.ts";
import { approveQualityAction, createReceiptAction, itemUnitsAction } from "./actions.ts";
import { ErrorNotice, LineStatus, submitWithKey, useKeyHolder, type ErrorContext, type ErrorInfo, type ReceiptView } from "./receipt-form.tsx";
import { useSonucSesi } from "../kalip/sonuc-sesi.ts";

const FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";
const LINK_BTN = `inline-flex min-h-12 min-w-12 items-center justify-center rounded-control border-2 border-border-strong bg-surface px-4 text-base font-bold text-ink ${FOCUS}`;
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
  readonly nextHref: string | null;
  /** Sunucudan toplam teslim sayısı (ALTIN-KURAL 15); yoksa sayfadaki satır sayısı gösterilir. */
  readonly total?: number;
  readonly canCreate: boolean;
  readonly canApprove: boolean;
  /** Paket kabulü girişi (yapılandırma + yetki sunucuda hesaplanır). */
  readonly packageHref: string | null;
  /** Yeni teslim formundan dönüşte kaydedilen belge numarası. */
  readonly created: string | null;
}

export function ReceiptsList({ slug, dark, receipts, nextHref, total, canCreate, canApprove, packageHref, created }: ReceiptsListProps) {
  const t = useTranslations("receiving");
  const tk = useTranslations("kural");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const approveKey = useKeyHolder();
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
        {created === null ? null : <Banner kind="success">{t("form.created", { number: created })}</Banner>}
        {approved === null ? null : <Banner kind="success">{t("quality.done", { number: approved })}</Banner>}
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
        {receipts.length === 0 ? (
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
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {r.lines.map((l) => (
                          <li key={l.id} className="flex min-w-0 flex-col gap-1 border-t border-border pt-2">
                            <span className="break-words text-base font-semibold">
                              {l.itemName} <span className="font-normal text-ink-muted">· {l.unitName}</span>
                            </span>
                            <LineStatus expected={l.expected} received={l.received} damaged={l.damaged} open={l.open} />
                          </li>
                        ))}
                      </ul>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        {r.status === "OPEN" ? (
                          <Link href={`${field}?receipt=${encodeURIComponent(r.id)}`} className={LINK_BTN}>
                            {t("list.receiveInField")}
                          </Link>
                        ) : null}
                        {canApprove ? (
                          <Button variant="secondary" disabled={busy} onClick={() => setConfirm(r)}>
                            {t("quality.approve")}
                          </Button>
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
            </div>
          </>
        )}
        {nextHref === null ? null : (
          <KalipDaha href={nextHref} iconD={LICON.plus}>
            {t("list.more")}
          </KalipDaha>
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
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<readonly Found[]>([]);
  const [picked, setPicked] = useState<(Found & { units: readonly UnitOption[] }) | null>(null);
  const [unitId, setUnitId] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ info: ErrorInfo; ctx: ErrorContext } | null>(null);
  useSonucSesi({ hata: error });
  const changed = (): void => createKey.contentChanged();

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 1) {
      setFound([]);
      return;
    }
    try {
      const r = await searchItemsAction({ slug, q: q.trim(), limit: 5 });
      if (r.ok) setFound(r.data.items);
    } catch {
      setFound([]);
    }
  }
  async function pick(f: Found) {
    setFound([]);
    setQuery(f.name);
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
    setQuery("");
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
      className="workflow-form flex min-w-0 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-ink-muted">{t("intro")}</p>
      {error === null ? null : <ErrorNotice error={error.info} context={error.ctx} />}
      <KalipGrup title={`1. ${t("k.groupSource")}`} sub={wh === undefined ? undefined : `${wh.code} · ${wh.name}`} d={LICON.depo} color="30475A">
        <div className="flex min-w-0 flex-col gap-3 p-3">
          {warehouses.length > 1 ? (
            <label className="flex min-w-0 flex-col gap-1 text-base font-semibold">
              {t("form.warehouse")}
              <select
                value={warehouseId}
                onChange={(e) => {
                  changed();
                  setWarehouseId(e.target.value);
                }}
                className={`min-h-12 w-full min-w-0 rounded-card border-2 border-border-strong bg-surface px-3 text-base text-ink ${FOCUS}`}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <TextField
            label={t("form.supplierRef")}
            hint={t("form.supplierRefHint")}
            value={supplierRef}
            maxLength={100}
            autoComplete="off"
            onChange={(e) => {
              changed();
              setSupplierRef(e.target.value);
            }}
          />
        </div>
      </KalipGrup>
      <KalipGrup title={`2. ${t("form.lines")}`} sub={String(lines.length)} d={LICON.box} color="2F5DA8">
        <div className="flex min-w-0 flex-col gap-3 p-3">
          {lines.length === 0 ? null : (
            <ul aria-label={t("form.lines")} className="m-0 flex list-none flex-col gap-2 p-0" data-testid="draft-lines">
              {lines.map((l, i) => (
                <li key={`${l.itemId}-${i}`} className="flex min-w-0 items-center justify-between gap-2 rounded-card bg-bg px-3 py-2">
                  <span className="min-w-0 break-words text-base text-ink">
                    {l.itemName} · {l.quantity} {l.unitName}
                  </span>
                  <Button
                    variant="secondary"
                    aria-label={t("form.removeLine", { name: l.itemName })}
                    onClick={() => {
                      changed();
                      setLines((x) => x.filter((_, j) => j !== i));
                    }}
                  >
                    {t("form.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex min-w-0 flex-col gap-2 rounded-card border-2 border-dashed border-border p-3">
            <TextField label={t("form.item")} hint={t("form.itemHint")} value={query} autoComplete="off" onChange={(e) => void search(e.target.value)} />
            {found.length === 0 ? null : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t("form.item")}>
                {found.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => void pick(f)} className={`flex min-h-12 w-full items-center rounded-control border-2 border-border bg-surface px-3 text-left text-base text-ink ${FOCUS}`}>
                      <span className="min-w-0 break-words">
                        {f.name} <span className="text-ink-muted">({f.code})</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {picked === null ? null : (
              <>
                <label className="flex min-w-0 flex-col gap-1 text-base font-semibold">
                  {t("form.unit")}
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={`min-h-12 w-full min-w-0 rounded-card border-2 border-border-strong bg-surface px-3 text-base text-ink ${FOCUS}`}>
                    {picked.units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {u.unitName || u.unitCode}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField label={t("form.expected")} inputMode="numeric" pattern="[0-9]*" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 9))} />
                <Button variant="secondary" onClick={addLine} disabled={!/^[1-9][0-9]{0,8}$/.test(qty)}>
                  {t("form.addLine")}
                </Button>
              </>
            )}
          </div>
        </div>
      </KalipGrup>
      <Button type="submit" variant="primary" loading={busy} disabled={lines.length === 0 || warehouseId === ""}>
        {t("form.save")}
      </Button>
    </form>
  );
}
