"use client";
// Toplu raf oluşturucu (T-250): "Bölge A, raf 1–10, göz 1–5" → önizleme → tek komutla oluşturma. Kod üretimi, sınır (2.000), çakışma
// ve yetki SUNUCUDADIR (domain `previewBulkLocations`/`createBulkLocations`); burada kural yoktur: yalnızca sunucu önizlemesi ve hatası
// gösterilir. İdempotency anahtarı (UUID) girdi değişince yenilenir; aynı girdiyle yeniden gönderim aynı anahtarı taşır.
// T-990 (B-97): pencere değil TAM EKRAN FORM (lokasyon ağacında `?bulk=1`; rehberin 2. adımı). Ana işlem ("50 lokasyonu oluştur") alt
// çubuğun ortasındadır ve önizleme geçerli olunca etkindir — kapalıyken dokunulursa neden söylenir (önizleme hazırlanıyor / çakışma /
// geçersiz aralık). `KalipFormEkran` yerine kalıbın form kabı + ortak çıkış koruması kullanılır: Kaydet'in etkinliği "değişiklik var"
// değil sunucu önizlemesidir (varsayılan aralık dokunmadan oluşturulabilir). Varsayılandan farklı aralık yarım iş sayılır (cam kutu).
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, feedback } from "@wms/ui";
import { createBulkLocationsAction, previewBulkLocationsAction, searchLocationsAction } from "../warehouses/actions.ts";
import type { ServerError } from "../warehouses/warehouses-view.tsx";
import { ServerErrorBanner } from "../warehouses/warehouses-view.tsx";
import { LICON } from "../../../design/kalip-icons.ts";
import { useCikisKorumasi } from "../kalip/cikis.tsx";
import { KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAlan, KalipGrup } from "../kalip/form.tsx";
import { eskiSurumBildir, eskiSurumMu } from "../kalip/surum.tsx";
import { Typeahead } from "./typeahead.tsx";

interface Preview {
  readonly count: number;
  readonly first: string;
  readonly last: string;
  readonly sample: readonly string[];
  readonly conflicts: readonly string[];
  readonly conflictCount: number;
  readonly max: number;
}
interface LocOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

const NUM = { inputMode: "numeric" as const, pattern: "[0-9]*", maxLength: 3, autoComplete: "off" };
const LIST_CLS = "m-0 grid max-h-40 min-w-0 list-none grid-cols-2 gap-1 overflow-y-auto overscroll-contain rounded-card border-2 border-border bg-bg p-2 text-sm font-semibold text-ink";
/** Akıllı varsayılan aralık (dokunmadan oluşturulabilir; değişmesi yarım iş sayılır). */
const DEFAULTS = { zone: "A", rackFrom: "1", rackTo: "10", levelFrom: "1", levelTo: "5" } as const;

function toInt(v: string): number {
  return v.trim() === "" ? Number.NaN : Number(v);
}

export function BulkBuilder({
  dark,
  slug,
  warehouseId,
  warehouseName,
  returnTo,
  onBack,
  onDone,
}: {
  dark: boolean;
  slug: string;
  warehouseId: string;
  warehouseName: string;
  returnTo: string;
  onBack: () => void;
  onDone: (r: { created: number; first: string; last: string; replayed: boolean }) => void;
}) {
  const t = useTranslations("easySetup.bulk");
  const tp = useTranslations("easySetup.picker");
  const tkal = useTranslations("kalip");
  const { say, node: toast } = useKalipToast("form");
  const [zone, setZone] = useState<string>(DEFAULTS.zone);
  const [rackFrom, setRackFrom] = useState<string>(DEFAULTS.rackFrom);
  const [rackTo, setRackTo] = useState<string>(DEFAULTS.rackTo);
  const [levelFrom, setLevelFrom] = useState<string>(DEFAULTS.levelFrom);
  const [levelTo, setLevelTo] = useState<string>(DEFAULTS.levelTo);
  const [parent, setParent] = useState<LocOption | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<ServerError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);

  const sig = [zone, rackFrom, rackTo, levelFrom, levelTo, parent?.id ?? ""].join("|");
  const dirty = sig !== [DEFAULTS.zone, DEFAULTS.rackFrom, DEFAULTS.rackTo, DEFAULTS.levelFrom, DEFAULTS.levelTo, ""].join("|");

  // Girdi değiştikçe sunucu önizlemesi (400 ms bekleme; eski yanıt yok sayılır; ret yakalanır).
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      previewBulkLocationsAction({
        slug,
        warehouseId,
        parentId: parent?.id ?? null,
        zone,
        rackFrom: toInt(rackFrom),
        rackTo: toInt(rackTo),
        levelFrom: toInt(levelFrom),
        levelTo: toInt(levelTo),
      }).then(
        (r) => {
          if (!live) return;
          setLoading(false);
          if (r.ok) {
            setPreview(r.data);
            setPreviewError(null);
          } else {
            setPreview(null);
            setPreviewError({ code: r.error.code, detail: r.error.detail, requestId: r.error.requestId });
          }
        },
        (e: unknown) => {
          if (eskiSurumMu(e)) eskiSurumBildir();
          if (!live) return;
          setLoading(false);
          setPreview(null);
          setPreviewError({ code: "INTERNAL" });
        },
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // sig tüm alanları kapsar
  }, [slug, warehouseId, sig]);

  const canSubmit = preview !== null && preview.conflictCount === 0 && !loading && !busy;

  const create = useCallback(async (): Promise<boolean> => {
    if (!canSubmit) {
      feedback.error();
      return false;
    }
    if (keyRef.current === null || keyRef.current.sig !== sig) keyRef.current = { sig, key: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    let res: Awaited<ReturnType<typeof createBulkLocationsAction>>;
    try {
      res = await createBulkLocationsAction({
        slug,
        warehouseId,
        parentId: parent?.id ?? null,
        zone,
        rackFrom: toInt(rackFrom),
        rackTo: toInt(rackTo),
        levelFrom: toInt(levelFrom),
        levelTo: toInt(levelTo),
        idempotencyKey: keyRef.current.key,
      });
    } catch (e) {
      setBusy(false);
      feedback.error();
      if (eskiSurumMu(e)) eskiSurumBildir();
      else say("err", tkal("saveFailed"));
      return false;
    }
    setBusy(false);
    if (!res.ok) {
      feedback.error();
      setError({ code: res.error.code, detail: res.error.detail, requestId: res.error.requestId });
      return false;
    }
    feedback.ok();
    onDone(res.data);
    return true;
  }, [canSubmit, sig, slug, warehouseId, parent, zone, rackFrom, rackTo, levelFrom, levelTo, onDone, say, tkal]);

  const korunan = useCikisKorumasi(dirty && !busy, { dark, text: t("leaveText"), saveLabel: t("leaveSave"), onSave: create });

  const invalid = previewError !== null && previewError.code === "VALIDATION_FAILED" && previewError.detail === undefined;
  const tooMany = previewError?.detail === "DOCUMENT_TOO_LARGE";
  const reason = busy
    ? tkal("saving")
    : loading
      ? t("previewLoading")
      : preview !== null && preview.conflictCount > 0
        ? `${t("conflictsTitle", { count: preview.conflictCount })}. ${t("conflictsAction")}`
        : invalid
          ? `${t("invalid")} ${t("invalidAction")}`
          : tooMany
            ? `${t("tooMany", { max: 2000 })} ${t("tooManyAction")}`
            : tkal("mainOff");
  const errScope = "bulk" as const;
  return (
    <KalipEkran
      kind="form"
      dark={dark}
      title={t("title")}
      icon={{ d: LICON.raf, color: "2F7D5B" }}
      subtitle={warehouseName}
      testId="bulk-form"
      bar={{
        back: { onClick: () => korunan.sor(onBack), aria: tkal("back") },
        main: {
          label: t("submitShort"),
          aria: preview === null ? t("submit") : t("submitCount", { count: preview.count }),
          d: LICON.check,
          onClick: () => void create(),
          disabled: !canSubmit,
          disabledReason: reason,
          wait: busy,
          testId: "bulk-submit",
        },
      }}
      overlays={
        <>
          {toast}
          {korunan.kutu}
        </>
      }
    >
      <div className="kfl">
        <form
          className="kfc"
          aria-label={t("title")}
          noValidate
          data-dirty={dirty ? "true" : "false"}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <KalipGrup title={t("title")} sub={t("intro")} d={LICON.raf} color="2F7D5B">
            <KalipAlan label={t("zone")} hint={t("zoneHint")} name="zone" value={zone} onChange={(e) => setZone(e.target.value)} autoCapitalize="characters" autoComplete="off" maxLength={8} />
            <div className="sxr">
              <KalipAlan label={t("rackFrom")} name="rackFrom" value={rackFrom} onChange={(e) => setRackFrom(e.target.value)} {...NUM} />
              <KalipAlan label={t("rackTo")} name="rackTo" value={rackTo} onChange={(e) => setRackTo(e.target.value)} {...NUM} />
            </div>
            <div className="sxr">
              <KalipAlan label={t("levelFrom")} name="levelFrom" value={levelFrom} onChange={(e) => setLevelFrom(e.target.value)} {...NUM} />
              <KalipAlan label={t("levelTo")} name="levelTo" value={levelTo} onChange={(e) => setLevelTo(e.target.value)} {...NUM} />
            </div>
          </KalipGrup>

          <KalipGrup title={t("previewTitle")} d={LICON.grid} color="0E7C7B">
            <section aria-label={t("previewTitle")} data-testid="bulk-preview" aria-live="polite" className="flex min-w-0 flex-col gap-2">
              {loading && preview === null ? <p className="text-sm text-ink-muted">{t("previewLoading")}</p> : null}
              {previewError ? (
                invalid ? (
                  <Banner kind="warning">
                    {t("invalid")} {t("invalidAction")}
                  </Banner>
                ) : tooMany ? (
                  <Banner kind="warning">
                    {t("tooMany", { max: 2000 })} {t("tooManyAction")}
                  </Banner>
                ) : (
                  <ServerErrorBanner error={previewError} returnTo={returnTo} scope={errScope} />
                )
              ) : null}
              {preview === null ? null : (
                <>
                  <p data-testid="bulk-summary" className="break-words text-base font-semibold">
                    {preview.count === 1 ? t("previewOne", { first: preview.first }) : t("previewSummary", { count: preview.count, first: preview.first, last: preview.last })}
                  </p>
                  <ul aria-label={t("previewListLabel")} data-testid="bulk-preview-list" className={LIST_CLS}>
                    {preview.sample.map((c) => (
                      <li key={c} className="min-w-0 break-all py-1">
                        {c}
                      </li>
                    ))}
                  </ul>
                  {preview.count > preview.sample.length ? <p className="text-sm text-ink-muted">{t("previewMore", { shown: preview.sample.length })}</p> : null}
                  {preview.conflictCount > 0 ? (
                    <Banner kind="error">
                      <p>
                        {t("conflictsTitle", { count: preview.conflictCount })}. {t("conflictsAction")}
                      </p>
                      <ul aria-label={t("conflictsListLabel")} data-testid="bulk-conflicts" className={`${LIST_CLS} mt-2`}>
                        {preview.conflicts.map((c) => (
                          <li key={c} className="min-w-0 break-all py-1">
                            {c}
                          </li>
                        ))}
                      </ul>
                      {preview.conflictCount > preview.conflicts.length ? <p className="mt-1 text-sm">{t("conflictsMore", { shown: preview.conflicts.length })}</p> : null}
                    </Banner>
                  ) : null}
                </>
              )}
            </section>
          </KalipGrup>

          <KalipGrup title={t("advanced")} d={LICON.gear} color="4E6476">
            {/* Telefonda grup alt yazısı (kaynak `.sgh small`) gizli: seçim her boyutta görünür satırda. */}
            <p className="khint" aria-live="polite">{parent === null ? t("parentNone") : tp("selected", { name: `${parent.name} (${parent.code})` })}</p>
            {parent === null ? null : (
              <button type="button" className="btn n" onClick={() => setParent(null)} style={{ alignSelf: "flex-start" }}>
                {t("parentClear")}
              </button>
            )}
            {/* Yazdıkça arama alanı kalıp penceresi görünümünü (`.dzf.kpen` alanı + öneri listesi) taşır. */}
            <div className={`dzf kpen${dark ? " dz-dark" : ""}`} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <Typeahead<LocOption>
                label={t("parent")}
                hint={t("parentHint")}
                listLabel={tp("listLabel")}
                scanLabel={t("scanParent")}
                clearOnSelect
                variant="kalip"
                search={async (q) => {
                  const r = await searchLocationsAction({ slug, warehouseId, q, limit: 8 });
                  return r.ok ? r.data : [];
                }}
                toSuggestion={(l) => ({ key: l.id, primary: l.code, secondary: l.name })}
                onSelect={(l) => {
                  feedback.ok();
                  setParent(l);
                }}
                scan={{
                  resolve: async (v) => {
                    const r = await searchLocationsAction({ slug, warehouseId, q: v, limit: 5 });
                    if (!r.ok) return [];
                    const exact = r.data.filter((l) => l.code.toLowerCase() === v.trim().toLowerCase());
                    return exact.length > 0 ? exact : r.data;
                  },
                }}
              />
            </div>
          </KalipGrup>
          {error ? <ServerErrorBanner error={error} returnTo={returnTo} scope={errScope} /> : null}
          <button type="submit" className="sr" tabIndex={-1} aria-hidden="true">
            {t("submit")}
          </button>
        </form>
      </div>
    </KalipEkran>
  );
}
