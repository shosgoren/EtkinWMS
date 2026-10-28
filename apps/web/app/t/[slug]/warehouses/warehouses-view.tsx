"use client";
// Depo listesi ekranı (T-207). Yetki ve iş kuralları SUNUCUDADIR: `canManage` yalnızca gösterimdir (kilit + açıklama);
// eylemler sunucuda `settings.manage` ister. Kod normalleştirmesi (A-98) istemcide YOK: sunucunun döndürdüğü kod gösterilir.
// Mobilde kart görünümü (tablo yok → yatay taşma yok). Sunucu reddi neden + sonraki eylemle gösterilir.
// T-971 (B-63): LİSTE kalıbı (KalipListe.dc.html). Kart `.uc` bağlantısı "Lokasyonları aç"; kartın altında küçük `.btn` eylem satırı
// (kod değiştir / arşivle — `<a>` içine düğme gömülmez). T-978: arama (`.lsearch`, GET `q`: kod/ad, sunucuda listWarehouses). Bilinçli
// farklar: süzgeç çipi yok (yalnız aktif/arşivli; kart rozeti gösterir); rozet = aktif lokasyon sayısı (sunucu sayımı); bildirimler kalıp balonunda (toast).
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { feedback } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { useSetupProgress } from "../easy-setup/setup-guide.tsx";
import { CodeChangedNotice, CodeEditForm } from "../code-edit-dialog.tsx";
import type { AlanKurali } from "../kalip/dogrula.ts";
import { Ico, KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup } from "../kalip/form.tsx";
import { KalipAra, KalipBos, KalipCipler, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { YolculukGiris } from "../yolculuk/yolculuk.tsx";
import { KalipGorunumSec, KalipSonsuz, useKalipDerinlik, KalipSutunSec, KalipTablo, useKalipGorunum, useKalipSutunlar, type KalipSutun } from "../kalip/tablo.tsx";
import { KalipOnay } from "../kalip/pencere.tsx";
import { KalipSecim } from "../kalip/secim.tsx";
import { KalipUyari } from "../kalip/uyari.tsx";
import { eskiSurumBildir, eskiSurumMu } from "../kalip/surum.tsx";
import { kdz } from "../kalip/tokens.ts";
import { archiveWarehouseAction, createWarehouseAction, loadMoreWarehousesAction, renameWarehouseAction, suggestCodeAction } from "./actions.ts";

/** Sunucu eylem hatası (`ActionResult.error`): yalnızca kod + ayrıntı + istek kimliği kullanılır. */
export interface ServerError {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}

const KNOWN = ["idempotency_mismatch", "forbidden", "unauthenticated", "not_found", "validation_failed", "version_conflict", "rate_limited", "tenant_suspended", "tenant_closing", "internal"];
const DETAILED = [
  "forbidden_mfa_required",
  "forbidden_warehouse_out_of_scope",
  "unauthenticated_recent_auth_required",
  "validation_failed_code_taken",
  "validation_failed_code_ambiguous",
  "validation_failed_in_use",
  "validation_failed_plan_limit",
  "validation_failed_parent_invalid",
  "validation_failed_document_too_large",
  "validation_failed_idempotency_key_required",
];

/**
 * Sunucu hatası → `warehouses.errors.<anahtar>` (+ `<anahtar>Action` sonraki eylem). Kod/ayrıntı sunucudan gelir;
 * yalnızca bilinen eşlemeler kullanılır, aksi halde genel `internal`. `IN_USE` metni kapsama göre (depo/lokasyon) ayrışır.
 */
export function errorKey(error: Pick<ServerError, "code" | "detail">, scope: "warehouse" | "location" | "bulk" = "warehouse"): string {
  const base = error.code.toLowerCase();
  const key = KNOWN.includes(base) ? base : "internal";
  if (error.detail !== undefined) {
    const detailed = `${key}_${error.detail.toLowerCase()}`;
    if (DETAILED.includes(detailed)) {
      if (detailed === "validation_failed_in_use" && scope === "location") return "validation_failed_in_use_location";
      if (detailed === "validation_failed_code_taken" && scope === "bulk") return "validation_failed_code_taken_bulk";
      return detailed;
    }
  }
  return key;
}

/** Kod önerisi yanıt süresi sınırı; aşılırsa kod alanı açılır (T-259). */
const SUGGEST_TIMEOUT_MS = 5000;
/** Sunucu reddi: neden + sonraki eylem, gerekirse MFA / yeniden giriş bağlantısı, destek kodu. T-1121: kalıp uyarı bandı (eski Banner yerine). */
export function ServerErrorBanner({ error, returnTo, scope = "warehouse" }: { error: ServerError; returnTo: string; scope?: "warehouse" | "location" | "bulk" }) {
  const t = useTranslations("warehouses.errors");
  const key = errorKey(error, scope);
  return (
    <KalipUyari tone="hata">
      <p>
        {t(key)} {t(`${key}Action`)}
      </p>
      {error.detail === "MFA_REQUIRED" ? <a href={`/mfa?next=${encodeURIComponent(returnTo)}`}>{t("mfaLink")}</a> : null}
      {error.detail === "RECENT_AUTH_REQUIRED" ? <a href={`/login?reauth=1&next=${encodeURIComponent(returnTo)}`}>{t("loginLink")}</a> : null}
      <small>
        {t("code", { code: error.detail === undefined ? error.code : `${error.code}/${error.detail}` })}
        {error.requestId ? ` · ${error.requestId}` : ""}
      </small>
    </KalipUyari>
  );
}

export interface CreateValues {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  /** Kod kullanıcı tarafından değiştirilmedi (önerilen kod): çakışmada sunucu sıradaki öneriyle yeniden dener (T-250). */
  readonly autoCode: boolean;
}

/** Lokasyon türü görünümü (kaynak paletinden; anlamı tür etiketi taşır). */
export const KIND_VISUAL: Readonly<Record<string, { readonly d: string; readonly color: string }>> = {
  RECEIVING: { d: LICON.moveIn, color: "2F5DA8" },
  STORAGE: { d: LICON.raf, color: "0E7C7B" },
  STAGING: { d: LICON.koli, color: "E56A00" },
  TRANSIT: { d: LICON.transfer, color: "6C4BD8" },
};

/** Sunucu reddinin tek satırlık metni (neden + sonraki eylem). */
export function useErrorText(): (e: ServerError, scope?: "warehouse" | "location" | "bulk") => string {
  const t = useTranslations("warehouses.errors");
  return (e, scope = "warehouse") => {
    const key = errorKey(e, scope);
    return `${t(key)} ${t(`${key}Action`)}`.trim();
  };
}

/**
 * Oluşturma — TAM EKRAN FORM (T-990; depo ve lokasyon ortak, T-250). Açılışta sıradaki kod SUNUCUDAN istenir ve hazır gelir (öneri
 * "değişiklik" sayılmaz); zorunlu olan yalnızca ad. Akıllı varsayılan ad (ilk depo "Ana depo") önerilmiş bir kayıttır: Kaydet hemen
 * etkindir. Lokasyon türü renkli seçim kutuları (yerel açılır liste yok). Kod çakışması kod alanının altında, diğer ret genel neden.
 * Doğrulama, çıkış kutusu ve Kaydet ortak `KalipFormEkran`'dadır.
 */
export function CreateForm({
  dark,
  title,
  intro,
  kinds,
  returnTo,
  scope,
  defaultName = "",
  suggest,
  onBack,
  onDone,
  submit,
  testId,
}: {
  dark: boolean;
  title: string;
  /** Grubun alt satırı (ör. "Bağlı olduğu yer: …"). */
  intro?: string;
  /** Verilirse tür seçimi gösterilir (değerler domain `LocationKindValue`). */
  kinds?: readonly string[];
  returnTo: string;
  scope: "warehouse" | "location";
  /** Ad alanının önerilen başlangıç değeri (akıllı varsayılan; geç gelirse yazılmamış ada uygulanır). */
  defaultName?: string;
  /** Sıradaki kodu sunucudan ister; başarısızsa `null` (kullanıcı kodu kendisi yazar). Ret yakalanır. */
  suggest: () => Promise<string | null>;
  onBack: () => void;
  onDone: (result: unknown) => void;
  submit: (v: CreateValues) => Promise<{ ok: true; data?: unknown } | { ok: false; error: ServerError }>;
  testId: string;
}) {
  const t = useTranslations("warehouses.form");
  const te = useTranslations("easySetup.code");
  const tk = useTranslations("warehouses.kind");
  const errText = useErrorText();
  const [initial, setInitial] = useState({ name: "", code: "", kind: "STORAGE" });
  const [v, setV] = useState({ name: defaultName, code: "", kind: "STORAGE" });
  const [touched, setTouched] = useState(false);
  // Gecikmeli öneri yanıtı kapanışın (closure) bayat `touched` değerini görmesin diye ref (T-259 MINOR-2).
  const touchedRef = useRef(false);
  const nameTouched = useRef(false);
  const [codeState, setCodeState] = useState<"loading" | "ready" | "failed">("loading");
  const [linkErr, setLinkErr] = useState<ServerError | null>(null);
  const created = useRef<unknown>(undefined);
  const set = (k: "name" | "code" | "kind", val: string): void => setV((cur) => ({ ...cur, [k]: val }));

  // Akıllı varsayılan ad sonradan gelirse (kurulum durumu okunur) kullanıcı adı yazmadıysa uygulanır.
  useEffect(() => {
    if (defaultName === "" || nameTouched.current) return;
    setV((cur) => (cur.name === "" ? { ...cur, name: defaultName } : cur));
  }, [defaultName]);

  // T-990 kök neden (ItemForm ile aynı): öneri çağrısı reddedilirse (yayından sonra eski sayfa) `.then` hiç çalışmıyor, 5 sn sonra
  // yanıltıcı "öneri alınamadı" yazıyordu. Ret yakalanır; eski sürümse "Uygulama güncellendi — Yenile" penceresi açılır.
  useEffect(() => {
    let live = true;
    let settled = false;
    // Öneri hiç dönmezse alan sonsuza dek salt okunur kalmasın: süre dolunca "failed" (kullanıcı kodu kendisi yazar).
    const timer = setTimeout(() => {
      if (live && !settled) {
        settled = true;
        setCodeState("failed");
      }
    }, SUGGEST_TIMEOUT_MS);
    const done = (c: string | null): void => {
      if (!live || settled) return;
      settled = true;
      clearTimeout(timer);
      if (c === null) {
        setCodeState("failed");
        return;
      }
      // Kullanıcı kodu değiştirdiyse (`touched`; silip boş bırakmak dahil) öneri uygulanmaz (N-14: sessiz değişiklik yok).
      if (!touchedRef.current) {
        setV((cur) => ({ ...cur, code: c }));
        setInitial((cur) => ({ ...cur, code: c }));
      }
      setCodeState("ready");
    };
    suggest().then(done, (e: unknown) => {
      if (eskiSurumMu(e)) eskiSurumBildir();
      done(null);
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Açılışta bir kez (`suggest` kimliği değişse de form yeniden başlamaz).
  }, []);

  async function save(): Promise<KaydetSonuc> {
    setLinkErr(null);
    const res = await submit({ code: v.code, name: v.name, kind: v.kind, autoCode: !touched && codeState === "ready" });
    if (!res.ok) {
      const text = errText(res.error, scope);
      const key = errorKey(res.error, scope);
      if (key === "validation_failed_code_taken" || key === "validation_failed_code_ambiguous") return { ok: false, alan: { code: text } };
      if (res.error.detail === "MFA_REQUIRED" || res.error.detail === "RECENT_AUTH_REQUIRED") setLinkErr(res.error);
      return { ok: false, mesaj: res.error.requestId === undefined ? text : `${text} · ${res.error.requestId}` };
    }
    created.current = res.data;
    return { ok: true };
  }

  const rules: AlanKurali[] = [
    { name: "name", label: t("name"), required: true, maxLength: 512 },
    { name: "code", label: t("code"), required: true, maxLength: 512 },
  ];
  const vis = scope === "warehouse" ? { d: LICON.depo, color: "30475A" } : (KIND_VISUAL[v.kind] ?? { d: LICON.raf, color: "0E7C7B" });
  const codeHint = codeState === "loading" ? te("loading") : codeState === "failed" ? te("failed") : touched ? `${te("custom")} ${t("codeHint")}` : `${te("suggested")} ${t("codeHint")}`;
  return (
    <KalipFormEkran
      dark={dark}
      title={title}
      icon={vis}
      testId={testId}
      values={v}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={() => onDone(created.current)}
      onBack={onBack}
      preview={<KalipOnizleme name={v.name} code={v.code} d={vis.d} color={vis.color} {...(kinds === undefined ? {} : { kind: tk(v.kind) })} />}
    >
      <KalipGrup title={title} {...(intro === undefined ? {} : { sub: intro })} d={vis.d} color={vis.color}>
        <KalipAlan
          label={`${t("name")} *`}
          name="name"
          value={v.name}
          onChange={(e) => {
            nameTouched.current = true;
            set("name", e.target.value);
          }}
          autoComplete="off"
          maxLength={512}
        />
        <KalipAlan
          label={`${t("code")} *`}
          hint={codeHint}
          name="code"
          value={v.code}
          readOnly={codeState === "loading"}
          aria-busy={codeState === "loading"}
          onChange={(e) => {
            touchedRef.current = true;
            setTouched(true);
            set("code", e.target.value);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={512}
        />
        {kinds === undefined ? null : (
          <KalipSecim
            name="kind"
            label={t("kind")}
            value={v.kind}
            color={vis.color}
            onPick={(id) => set("kind", id)}
            options={kinds.map((k) => ({ id: k, label: tk(k), d: KIND_VISUAL[k]?.d ?? LICON.raf, color: KIND_VISUAL[k]?.color ?? "0E7C7B" }))}
            testId="create-kind"
          />
        )}
        {linkErr === null ? null : <ServerErrorBanner error={linkErr} returnTo={returnTo} scope={scope} />}
      </KalipGrup>
    </KalipFormEkran>
  );
}

export interface WarehouseView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  /** Aktif lokasyon sayısı; `capped` ise gerçek sayı en az bu kadardır ("N+"). */
  readonly locationCount: number;
  readonly locationCountCapped: boolean;
}

const c = (hex: string): string => kdz("dzl", hex);
/** Kart eylem satırı düğmesi (kaynak `.btn`, küçük); kilitliyken soluk. */
const actBtn = (bg: string, disabled: boolean): CSSProperties => ({ background: c(bg), color: c("FFFFFF"), minHeight: 48, opacity: disabled ? 0.5 : 1 });

export function WarehousesView({
  slug,
  dark,
  canManage,
  warehouses: ilkDepolar,
  nextAfter,
  q = "",
  archived = false,
  total,
}: {
  slug: string;
  dark: boolean;
  canManage: boolean;
  warehouses: readonly WarehouseView[];
  /** Sonraki sayfa imleci (son görülen kod); yoksa `null`. */
  nextAfter: string | null;
  /** T-1055'ten beri yalnız eski `?after=` adresleri için (kaydırmalı listede kullanılmaz). */
  firstPage?: boolean;
  /** T-978: sunucu araması (kod/ad); boş = tümü. */
  q?: string;
  /** T-1040: "Arşivli" süzgeci (`?arsiv=1`): yalnız arşivdeki depolar. */
  archived?: boolean;
  /** Sunucudan aramaya uyan toplam depo sayısı (ALTIN-KURAL 15). */
  total?: number;
}) {
  const t = useTranslations("warehouses");
  // T-1055: kaydırınca eklenen sayfalar (sunucunun ilk sayfasının devamı); süzgeç / arama değişince (yeni ilk sayfa) sıfırlanır.
  const [ek, setEk] = useState<{ readonly bas: readonly WarehouseView[]; readonly rows: readonly WarehouseView[]; readonly after: string | null }>({ bas: ilkDepolar, rows: [], after: nextAfter });
  const guncel = ek.bas === ilkDepolar ? ek : { bas: ilkDepolar, rows: [], after: nextAfter };
  if (guncel !== ek) setEk(guncel);
  // Sonraki sayfalar arada kaymış olabilir: aynı depo iki kez çizilmez.
  const warehouses = useMemo(() => {
    const ilk = new Set(ilkDepolar.map((w) => w.id));
    return [...ilkDepolar, ...guncel.rows.filter((r) => !ilk.has(r.id))];
  }, [ilkDepolar, guncel.rows]);
  const sonrakiAfter = guncel.after;
  const dahaYukle = useCallback(async (): Promise<boolean> => {
    if (sonrakiAfter === null) return true;
    const r = await loadMoreWarehousesAction({ slug, q, archived, after: sonrakiAfter });
    if (!r.ok) return false;
    setEk((o) => (o.bas !== ilkDepolar ? o : { bas: o.bas, rows: [...o.rows, ...r.data.rows], after: r.data.nextAfter }));
    return true;
  }, [sonrakiAfter, slug, q, archived, ilkDepolar]);
  // Kayda girip geri dönünce aynı uzunluk (sunucudan taze; yalnız sayı hatırlanır).
  useKalipDerinlik(warehouses.length, sonrakiAfter !== null, dahaYukle);
  const tr = useTranslations("kural");
  const tk = useTranslations("warehouses.k");
  const te = useTranslations("easySetup");
  const locale = useLocale();
  const router = useRouter();
  const home = `/t/${encodeURIComponent(slug)}`;
  const base = `${home}/warehouses`;
  // T-1040: liste adresi (arama + Arşivli süzgeci + sayfa imleci birlikte taşınır).
  const pageHref = ({ arsiv = archived, after }: { arsiv?: boolean; after?: string }): string => {
    const p = new URLSearchParams();
    if (q !== "") p.set("q", q);
    if (arsiv) p.set("arsiv", "1");
    if (after !== undefined) p.set("after", after);
    const qs = p.toString();
    return qs === "" ? base : `${base}?${qs}`;
  };
  const chips: KalipCip[] = [
    { id: "active", label: t("chipActive"), d: LICON.grid, color: "172E42", on: !archived, href: pageHref({ arsiv: false }) },
    { id: "archived", label: t("chipArchived"), d: LICON.lock, color: "4E6476", on: archived, href: pageHref({ arsiv: true }) },
  ];
  const [archiving, setArchiving] = useState<WarehouseView | null>(null);
  const [codeChanged, setCodeChanged] = useState<{ readonly id: string; readonly from: string; readonly to: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);
  const [version, setVersion] = useState(0);
  const progress = useSetupProgress(slug, canManage, version);
  const params = useSearchParams();
  const { say, node: toast } = useKalipToast("liste");
  const errText = useErrorText();
  const ok = (text: string): void => {
    say("ok", text);
  };
  const fail = (e: ServerError): void => {
    feedback.error();
    setError(e);
  };

  // T-990: ekleme ve kod değiştirme TAM EKRAN FORMDUR; adres `?new=1` (rehberin büyük düğmesi de buraya gelir) / `?kod=<depo kimliği>`.
  // Geri listeye (arama ve sayfa imleci korunur) döner.
  const listHref = (() => {
    const p = new URLSearchParams(params.toString());
    p.delete("new");
    p.delete("kod");
    const qs = p.toString();
    return qs === "" ? base : `${base}?${qs}`;
  })();
  const withParam = (k: string, val: string): string => `${listHref}${listHref.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(val)}`;
  const creating = params.get("new") === "1" && canManage;
  const kodId = params.get("kod");
  const editing = kodId === null || !canManage ? undefined : warehouses.find((w) => w.id === kodId && w.status === "ACTIVE");
  const toList = (): void => router.push(listHref);

  async function changeCode(id: string, code: string) {
    const r = await renameWarehouseAction({ slug, warehouseId: id, code });
    return r.ok ? ({ ok: true, changed: r.data.changed } as const) : ({ ok: false, error: { code: r.error.code, detail: r.error.detail, requestId: r.error.requestId } } as const);
  }
  /** "Geri al" (N-03): eski koda dönüş aynı sunucu komutudur. */
  async function undoCode() {
    if (codeChanged === null) return;
    setUndoing(true);
    setError(null);
    const r = await changeCode(codeChanged.id, codeChanged.from);
    setUndoing(false);
    if (!r.ok) {
      fail(r.error);
      return;
    }
    setCodeChanged(null);
    ok(t("done.codeUndone"));
    router.refresh();
  }

  async function archive() {
    if (archiving === null) return;
    setBusy(true);
    setError(null);
    const res = await archiveWarehouseAction({ slug, warehouseId: archiving.id });
    setBusy(false);
    setArchiving(null);
    if (!res.ok) {
      fail({ code: res.error.code, detail: res.error.detail, requestId: res.error.requestId });
      return;
    }
    ok(t("done.archived"));
    router.refresh();
  }

  const openCreate = (): void => {
    feedback.minor();
    router.push(withParam("new", "1"));
  };

  const countLbl = total !== undefined ? tk("count", { n: total }) : sonrakiAfter === null ? tk("count", { n: warehouses.length }) : tk("countMore", { n: warehouses.length });
  // T-1055: sayfa satırı yok; listenin içinde en altta, görünür olmaya yaklaşınca sonraki 50 depo.
  const sonsuz = <KalipSonsuz devam={sonrakiAfter !== null} yukle={dahaYukle} metin={countLbl} testId="warehouses-sonsuz" />;
  const lockedId = "warehouse-locked";
  // T-1048 (STANDART §2): ortak liste kalıbı — Kart / Liste, Sütunlar, sıralanan tablo, sayfa satırı.
  const [gorunum, setGorunum] = useKalipGorunum("warehouses");
  const sutunlar = useMemo<readonly KalipSutun<WarehouseView>[]>(
    () => [
      { id: "code", baslik: t("colCode"), sabit: true, deger: (w) => w.code, sirala: (w) => w.code },
      { id: "name", baslik: t("colName"), sabit: true, deger: (w) => <span className="ktad" title={w.name}>{w.name}</span>, sirala: (w) => w.name },
      { id: "locs", baslik: t("colLocations"), sayi: true, deger: (w) => (w.locationCountCapped ? `${w.locationCount}+` : String(w.locationCount)), sirala: (w) => w.locationCount },
      { id: "state", baslik: t("colState"), deger: (w) => <span className={`ktpill ${w.status === "ACTIVE" ? "ok" : ""}`}>{t(`status.${w.status}`)}</span>, sirala: (w) => w.status },
      // Codex P2 (PR 197): Liste görünümü kartın yönetim işlemlerini (kodu değiştir, arşivle) kaybetmez; yalnız yetkili ve aktif depoda.
      ...(canManage
        ? [
            {
              id: "actions",
              baslik: t("colActions"),
              sabit: true,
              deger: (w: WarehouseView) =>
                w.status !== "ACTIVE" ? null : (
                  <span className="ktacts" role="group" aria-label={t("actionsFor", { name: w.name })}>
                    <button
                      type="button"
                      className="ktact"
                      aria-label={t("codeEdit.for", { name: w.name })}
                      title={t("codeEdit.button")}
                      onClick={() => {
                        feedback.minor();
                        router.push(`${listHref}${listHref.includes("?") ? "&" : "?"}kod=${encodeURIComponent(w.id)}`);
                      }}
                    >
                      <Ico d={LICON.pencil} size={18} />
                    </button>
                    <button
                      type="button"
                      className="ktact del"
                      aria-label={`${t("archive")} · ${w.name}`}
                      title={t("archive")}
                      onClick={() => {
                        feedback.minor();
                        setArchiving(w);
                      }}
                    >
                      <Ico d={LICON.trash} size={18} />
                    </button>
                  </span>
                ),
            },
          ]
        : []),
    ],
    [t, canManage, router, listHref],
  );
  const sutunSecim = useKalipSutunlar<WarehouseView>("warehouses", sutunlar);

  if (creating) {
    return (
      <CreateForm
        dark={dark}
        title={t("createTitle")}
        returnTo={base}
        scope="warehouse"
        testId="warehouse-form"
        defaultName={progress !== null && !progress.hasWarehouse ? te("form.defaultWarehouseName") : ""}
        suggest={async () => {
          const r = await suggestCodeAction({ slug, kind: "warehouse" });
          return r.ok ? r.data.code : null;
        }}
        onBack={toList}
        onDone={(data) => {
          ok(t("done.created"));
          setVersion((n) => n + 1);
          // İlk depo: doğrudan raf oluşturucuya git (rehberin 2. adımı).
          const id = (data as { warehouseId?: string } | undefined)?.warehouseId;
          if (progress !== null && !progress.hasLocation && id !== undefined) router.push(`${base}/${encodeURIComponent(id)}?bulk=1`);
          else {
            toList();
            router.refresh();
          }
        }}
        submit={async (v) => {
          const res = await createWarehouseAction({ slug, code: v.code, name: v.name, autoCode: v.autoCode });
          return res.ok ? { ok: true, data: res.data } : { ok: false, error: { code: res.error.code, detail: res.error.detail, requestId: res.error.requestId } };
        }}
      />
    );
  }
  if (editing !== undefined) {
    return (
      <CodeEditForm
        key={editing.id}
        dark={dark}
        subject={editing.name}
        current={editing.code}
        icon={{ d: LICON.depo, color: "30475A" }}
        testId="code-edit-form"
        onBack={toList}
        submit={(code) => changeCode(editing.id, code)}
        errorText={(e) => errText(e)}
        renderError={(e) => <ServerErrorBanner error={e} returnTo={base} />}
        onDone={(r) => {
          setError(null);
          if (r.changed) {
            feedback.ok();
            setCodeChanged({ id: editing.id, from: r.from, to: r.to });
          } else ok(t("done.codeSame"));
          toList();
          router.refresh();
        }}
      />
    );
  }

  return (
    <>
      <KalipEkran
        kind="liste"
        dark={dark}
        title={t("title")}
        icon={{ d: LICON.depo, color: "30475A" }}
        testId="warehouses"
        bar={{
          back: { href: home },
          main: { label: tk("add"), aria: t("create"), d: LICON.plus, disabled: !canManage, disabledReason: t("lockedReason"), onClick: openCreate, testId: "warehouses-add" },
        }}
        overlays={toast}
      >
        {!canManage ? (
          <p className="sr" id={lockedId}>
            {t("lockedReason")}
          </p>
        ) : null}
        {codeChanged ? <CodeChangedNotice from={codeChanged.from} to={codeChanged.to} busy={undoing} onUndo={() => void undoCode()} /> : null}
        {error ? <ServerErrorBanner error={error} returnTo={base} /> : null}
        {/* T-1054: eski "depo → raf → ürün" kutusu yerine asıl kurulum yolculuğunun girişi; bitince çıkmaz. */}
        <YolculukGiris dark={dark} />

        <KalipAra label={t("search")} placeholder={t("searchPlaceholder")} action={base} defaultValue={q} below={archived ? <input type="hidden" name="arsiv" value="1" /> : null} />
        <div className="ktbar">
          <KalipCipler label={t("filter")} chips={chips} />
          <span className="kttools">
            {gorunum === "liste" ? <KalipSutunSec sutunlar={sutunlar} secim={sutunSecim} /> : null}
            <KalipGorunumSec value={gorunum} onChange={setGorunum} />
          </span>
        </div>
        {warehouses.length === 0 && archived && q === "" ? (
          <KalipBos title={t("archivedEmpty")} iconD={LICON.lock} action={{ label: t("chipActive"), href: base, kind: "go" }} />
        ) : warehouses.length === 0 && q !== "" ? (
          <KalipBos title={tr("notFoundSearch")} hint={t("noMatchHint")} action={{ label: t("clearSearch"), href: base, kind: "clear" }} />
        ) : warehouses.length === 0 ? (
          <KalipBos
            title={t("empty")}
            hint={canManage ? t("emptyAction") : t("emptyReadOnly")}
            iconD={LICON.depo}
            action={canManage ? { label: tk("stepWarehouseCta"), onClick: openCreate, kind: "add" } : { label: tr("home"), href: home, kind: "go" }}
          />
        ) : (
          <>
            <KalipBaslik title={countLbl} />
            {gorunum === "liste" ? (
              <KalipTablo<WarehouseView>
                label={t("listLabel")}
                sutunlar={sutunSecim.gorunur}
                satirlar={warehouses}
                anahtar={(w) => w.id}
                href={(w) => `${base}/${encodeURIComponent(w.id)}`}
                satirAria={(w) => `${w.name} · ${w.code}`}
                testId="warehouses-table"
                sonu={sonsuz}
              />
            ) : (
            <KalipKartListe label={t("listLabel")}>
              {warehouses.map((w, i) => {
                const active = w.status === "ACTIVE";
                const count = w.locationCountCapped ? `${w.locationCount}+` : String(w.locationCount);
                const countText = w.locationCountCapped ? t("locationCountCapped", { count: w.locationCount }) : t("locationCount", { count: w.locationCount });
                const state = active ? t("status.ACTIVE") : t("status.ARCHIVED");
                return (
                  <div key={w.id} role="listitem" data-testid="warehouse-card" data-status={w.status} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                    <Link className="uc" style={{ animationDelay: `${i * 30}ms` }} href={`${base}/${encodeURIComponent(w.id)}`} aria-label={tk("cardAria", { name: w.name, code: w.code, count: countText, state })}>
                      <span className="uic" style={{ background: c(active ? "30475A" : "4E6476") }}>
                        <Ico d={LICON.depo} size={26} />
                      </span>
                      <span className="ut">
                        <b>{w.name}</b>
                        <small className="mono">{w.code}</small>
                        <span style={{ display: "flex", marginTop: 4 }}>
                          <span className={`pill ${active ? "ok" : "warn"}`}>{state.toLocaleUpperCase(locale === "en" ? "en" : "tr")}</span>
                        </span>
                      </span>
                      <span className="qb">
                        <b>{count}</b>
                        <small>{tk("locSub")}</small>
                      </span>
                    </Link>
                    {active ? (
                      <div role="group" aria-label={t("actionsFor", { name: w.name })} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <button
                          type="button"
                          className="btn"
                          style={actBtn("172E42", !canManage)}
                          disabled={!canManage}
                          aria-describedby={canManage ? undefined : lockedId}
                          aria-label={t("codeEdit.for", { name: w.name })}
                          onClick={() => {
                            feedback.minor();
                            router.push(withParam("kod", w.id));
                          }}
                        >
                          <Ico d={LICON.pencil} size={18} />
                          {t("codeEdit.button")}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={actBtn("C62828", !canManage)}
                          disabled={!canManage}
                          aria-describedby={canManage ? undefined : lockedId}
                          onClick={() => {
                            feedback.minor();
                            setArchiving(w);
                          }}
                        >
                          <Ico d={LICON.trash} size={18} />
                          {t("archive")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {sonsuz}
            </KalipKartListe>
            )}
          </>
        )}
      </KalipEkran>

      <KalipOnay
        open={archiving !== null}
        title={t("confirmArchive.title", { name: archiving?.name ?? "" })}
        description={t("confirmArchive.description", { name: archiving?.name ?? "", code: archiving?.code ?? "" })}
        confirmLabel={t("confirmArchive.button")}
        cancelLabel={t("form.cancel")}
        loading={busy}
        onConfirm={() => void archive()}
        onCancel={() => setArchiving(null)}
      />
    </>
  );
}
