"use client";
// T-428: cari kartlar ekranı; T-971 (B-63, I-18): LİSTE kalıbı (KalipListe.dc.html) + düzenleme FORM kalıbı (KalipForm.dc.html).
// Liste: arama (sunucuda, GET `?q=`; arşiv görünümü `?arsiv=1`), süzgeç çipleri (Etkin / Arşivli adresi değiştirir; tür çipleri yüklenen
// listeyi süzer), cari kartları, boş durum + Excel'den aktar. Karta dokununca kart TAM EKRAN FORMDA açılır (T-990 `KalipFormEkran`; adres
// `?new=1` / `?edit=<id>`): kimlik grubu (kod, ünvan, tür kutuları) + vergi/iletişim grubu, sağda canlı önizleme. Kaydet, doğrulama
// (zorunlu kod/ünvan, e-posta biçimi; sunucu alan hataları ilgili alanda), çıkış kutusu ortak sarmalayıcıdadır. Arşivle / arşivden çıkar
// formun altında. Yetki SUNUCUDADIR: `canEdit` yalnız gösterimdir.
// Bilinçli farklar (DESIGN-PARITY, T-971): çip sayıları yok (sunucu tür sayımı vermez); tür süzgeci yalnız yüklenen ≤100 kartı süzer.
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { SICON } from "../../../design/standart-icons.ts";
import type { AlanKurali } from "../kalip/dogrula.ts";
import { KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../kalip/form-ekran.tsx";
import { KalipAlan, KalipAlanSira, KalipGrup } from "../kalip/form.tsx";
import { KalipSecimGrubu } from "../kalip/secim.tsx";
import { KalipAra, KalipBos, KalipCipler, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { KalipGorunumSec, KalipSonsuz, KalipSutunSec, KalipTablo, useKalipDerinlik, useKalipGorunum, useKalipSutunlar, type KalipSutun } from "../kalip/tablo.tsx";
import { archivePartyAction, loadMorePartiesAction, savePartyAction, suggestPartyCodeAction } from "./actions.ts";
import { feedback } from "@wms/ui";

export interface PartyView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: "CUSTOMER" | "SUPPLIER" | "BOTH";
  readonly taxNo: string | null;
  readonly taxOffice: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly address: string | null;
  readonly archived: boolean;
  readonly version: number;
}

type Kind = PartyView["kind"];
type Form = Record<"code" | "name" | "taxNo" | "taxOffice" | "phone" | "email" | "city" | "address", string> & { kind: Kind };
const empty: Form = { code: "", name: "", kind: "CUSTOMER", taxNo: "", taxOffice: "", phone: "", email: "", city: "", address: "" };
const fromParty = (p: PartyView): Form => ({ code: p.code, name: p.name, kind: p.kind, taxNo: p.taxNo ?? "", taxOffice: p.taxOffice ?? "", phone: p.phone ?? "", email: p.email ?? "", city: p.city ?? "", address: p.address ?? "" });
const KINDS = ["CUSTOMER", "SUPPLIER", "BOTH"] as const;
// T-1117: tür simgeleri tuvaldeki tür seçimiyle aynı (`StandartYeniCari.dc.html`: Müşteri kişi, Tedarikçi kutu, İkisi de çift ok).
const KIND_VISUAL: Record<Kind, { readonly d: string; readonly color: string }> = {
  CUSTOMER: { d: SICON.kisi, color: "2F7D5B" },
  SUPPLIER: { d: SICON.kutu, color: "6C4BD8" },
  BOTH: { d: SICON.cevrim, color: "0E7C7B" },
};
/** T-1117 (STANDART §4): cari formunun şerit simgesi ve sütun renkleri (Kimlik yeşil, Vergi ve iletişim mavi, Adres ve teslimat turuncu). */
const FORM_ICON = { d: SICON.kisiler, color: "2F7D5B" } as const;
const G_KIMLIK = "2F7D5B";
const G_VERGI = "2F5DA8";
const G_ADRES = "C2702A";
const ICON = { d: LICON.people, color: "6C4BD8" } as const;

/** Sunucu alan sorunu → alan adı (formda ilgili alanın altında gösterilir). */
const ISSUE_FIELD: Record<string, keyof Form> = {
  CODE_MISSING: "code",
  CODE_INVALID: "code",
  CODE_DUPLICATE_FILE: "code",
  CODE_TAKEN: "code",
  NAME_MISSING: "name",
  NAME_INVALID: "name",
  KIND_UNKNOWN: "kind",
  TAX_NO_INVALID: "taxNo",
  PHONE_INVALID: "phone",
  EMAIL_INVALID: "email",
};

function PartyForm({ slug, dark, canEdit, party, onClose }: { slug: string; dark: boolean; canEdit: boolean; party: PartyView | null; onClose: (msg?: string) => void }) {
  const t = useTranslations("parties");
  const tr = useTranslations("kural");
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const [initial, setInitial] = useState<Form>(() => (party === null ? empty : fromParty(party)));
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string): void => setF((cur) => ({ ...cur, [k]: v }) as Form);
  // T-1093: yeni caride kod sunucudan önerilir (türe göre MUS / TED / CAR-0001) ve tür değişince yenilenir. Kullanıcı kodu değiştirdiyse
  // (silip boş bırakmak dahil) öneri uygulanmaz; gecikmeli yanıt bayat değeri görmesin diye ref. Öneri başlangıç değerine de yazılır:
  // yalnız önerilen kodla çıkmak "kaydedilmemiş değişiklik" sayılmaz.
  const touchedRef = useRef(false);
  // Codex P2: önerinin hangi tür için alındığı tutulur; tür değişince eski öneri hemen silinir (yeni gelene dek kod boş, kaydet zorunlu
  // alan uyarısı verir). Böylece tedarikçi eski müşteri önekiyle (`MUS-…`) "otomatik" kaydedilemez.
  const [suggested, setSuggested] = useState<{ readonly code: string; readonly kind: Kind } | null>(null);
  const yeni = party === null && canEdit;
  useEffect(() => {
    if (!yeni || touchedRef.current) return;
    let stale = false;
    const kind = f.kind;
    void suggestPartyCodeAction({ slug, kind }).then((r) => {
      if (stale || touchedRef.current || !r.ok) return;
      setSuggested({ code: r.data.code, kind });
      setF((cur) => ({ ...cur, code: r.data.code }));
      setInitial((cur) => ({ ...cur, code: r.data.code }));
    });
    return () => {
      stale = true;
    };
  }, [yeni, slug, f.kind]);
  // T-1117: sıra ekrandaki sıradır (tuval: önce Ünvan, sonra Cari kodu) — ilk hatalı alan buna göre odaklanır.
  const rules: AlanKurali[] = [
    { name: "name", label: t("f.name"), required: true, maxLength: 200 },
    { name: "code", label: t("f.code"), required: true, maxLength: 64 },
    { name: "kind", label: t("f.kind"), required: true },
    { name: "email", label: t("f.email"), kind: "email" },
  ];

  async function save(): Promise<KaydetSonuc> {
    const auto = party === null && !touchedRef.current && suggested !== null && suggested.kind === f.kind && f.code === suggested.code;
    const body = { slug, ...f, ...(party === null ? (auto ? { autoCode: true } : {}) : { id: party.id, expectedVersion: party.version }) };
    const r = await savePartyAction(body);
    if (!r.ok) return { ok: false, mesaj: r.error.code === "VERSION_CONFLICT" ? t("conflict") : t("failed", { code: r.error.code }) };
    if (!r.data.ok) {
      const field = ISSUE_FIELD[r.data.issue];
      const text = t(`issue.${r.data.issue}`);
      return field === undefined ? { ok: false, mesaj: text } : { ok: false, alan: { [field]: text } };
    }
    return { ok: true };
  }

  async function onArchive(): Promise<void> {
    if (party === null) return;
    setBusy(true);
    const r = await archivePartyAction({ slug, id: party.id, expectedVersion: party.version, archived: !party.archived });
    setBusy(false);
    if (!r.ok) {
      feedback.error(r.error.code === "VERSION_CONFLICT" ? t("conflict") : t("failed", { code: r.error.code }));
      return;
    }
    // Listeye geçiş (`onClose` → router.push) sunucudan taze okur; ayrıca `router.refresh()` çağrılmaz: geçişle yarışıp eski `?edit=`
    // adresini yeniden çizebiliyordu (T-1090: kart ekranından gelen `?edit=` arşivlenen cariyi `getParty` ile bulur, form açık kalırdı).
    if (party.archived) {
      onClose(t("restoredDone"));
      return;
    }
    // T-436 (ALTIN-KURAL 10): arşivleme geri dönüşlüdür — onay sorulmaz; birkaç saniye "Geri al" (sunucuda arşivden çıkarır).
    const id = party.id;
    const version = r.data.version;
    onClose();
    feedback.undo(t("archivedDone"), tr("undo"), async () => {
      const u = await archivePartyAction({ slug, id, expectedVersion: version, archived: false });
      if (u.ok) feedback.ok(tr("undone"));
      else feedback.error(tr("undoFailed"));
      router.refresh();
    });
  }

  const field = (k: Exclude<keyof Form, "kind">, ikon: { readonly d: string; readonly color: string }, extra: { required?: boolean; maxLength?: number; inputMode?: "tel" | "email"; placeholder?: string } = {}) => (
    <KalipAlan
      key={k}
      label={`${t(`f.${k}`)}${extra.required === true ? " *" : ""}`}
      ikon={ikon}
      placeholder={extra.placeholder}
      name={k}
      value={f[k]}
      onChange={(e) => {
        if (k === "code") touchedRef.current = true;
        set(k, e.target.value);
      }}
      readOnly={!canEdit}
      maxLength={extra.maxLength}
      inputMode={extra.inputMode}
      autoComplete="off"
    />
  );
  const title = party === null ? t("new") : party.name;
  // T-1117: yeni caride önerilen kod değişmeden duruyorsa şeritte "· otomatik kod".
  const autoNote = party === null && suggested !== null && suggested.kind === f.kind && f.code === suggested.code ? t("autoCode") : undefined;
  const kindPick = (
    <KalipSecimGrubu
      name="kind"
      label={t("f.kind")}
      value={f.kind}
      color={KIND_VISUAL[f.kind].color}
      disabled={!canEdit}
      onPick={(id) => {
        if (yeni && !touchedRef.current && id !== f.kind) {
          setSuggested(null);
          setF((cur) => ({ ...cur, kind: id as Kind, code: "" }));
          setInitial((cur) => ({ ...cur, code: "" }));
          return;
        }
        set("kind", id);
      }}
      options={KINDS.map((k) => ({ id: k, label: t(`kind.${k}`), d: KIND_VISUAL[k].d, color: KIND_VISUAL[k].color }))}
    />
  );
  return (
    <KalipFormEkran
      dark={dark}
      title={title}
      icon={FORM_ICON}
      subtitle={canEdit ? t("formHint") : t("readOnly")}
      testId="party-form"
      values={f}
      initial={initial}
      rules={rules}
      canEdit={canEdit}
      lockedTitle={t("readOnly")}
      lockedSub={t("readOnlySub")}
      onSave={save}
      onDone={() => onClose(t("saved"))}
      onBack={() => onClose()}
      homeHref={base}
      saveShort={t("saveShort")}
      saveAria={t("save")}
      savedText={t("saved")}
      leaveText={t("cf.text")}
      leaveSaveLabel={t("cf.save")}
      // T-1117 (STANDART §4, tuval "6 · Yeni cari"): üst şerit — büyük cari simgesi, "YENİ CARİ", canlı ünvan, kod (+ otomatik kod notu),
      // sağda büyük simgeli tür seçimi.
      preview={<KalipOnizleme name={f.name} code={f.code} d={FORM_ICON.d} color={FORM_ICON.color} kind={party === null ? t("stripNew") : t("stripEdit")} bos={t("stripEmpty")} kodNot={autoNote} secim={kindPick} />}
      footer={
        canEdit && party !== null ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn n" disabled={busy} onClick={() => void onArchive()} data-testid="party-archive">
              {party.archived ? t("restore") : t("archive")}
            </button>
          </div>
        ) : undefined
      }
    >
      {/* T-1117: üç sütun (masaüstü) — Kimlik · Vergi ve iletişim · Adres ve teslimat; telefonda alt alta. Tuvaldeki Kısa ad, İlçe ve
          Varsayılan teslimat alanlarının veri karşılığı yok (sütun yok) → çizilmez (T-1117 kartı). */}
      <KalipGrup title={t("gIdentity")} sub={t("gIdentitySub")} d={SICON.ad} color={G_KIMLIK} testId="party-g-identity">
        {field("name", { d: SICON.bina, color: G_KIMLIK }, { required: true, maxLength: 200, placeholder: t("ph.name") })}
        {field("code", { d: SICON.ad, color: G_KIMLIK }, { required: true, maxLength: 64 })}
      </KalipGrup>
      <KalipGrup title={t("gContact")} sub={t("gContactSub")} d={SICON.bilgi} color={G_VERGI} testId="party-g-contact">
        <KalipAlanSira>
          {field("taxNo", { d: SICON.belge, color: G_VERGI }, { inputMode: "tel" })}
          {field("taxOffice", { d: SICON.bina, color: G_VERGI })}
        </KalipAlanSira>
        {field("phone", { d: SICON.telefon, color: G_VERGI }, { inputMode: "tel", placeholder: t("ph.phone") })}
        {field("email", { d: SICON.eposta, color: G_VERGI }, { inputMode: "email", placeholder: t("ph.email") })}
      </KalipGrup>
      <KalipGrup title={t("gAddress")} d={SICON.kamyon} color={G_ADRES} testId="party-g-address">
        {field("city", { d: SICON.konum, color: G_ADRES })}
        {field("address", { d: SICON.konum, color: G_ADRES }, { maxLength: 500, placeholder: t("ph.address") })}
      </KalipGrup>
    </KalipFormEkran>
  );
}

export function PartiesView({
  slug,
  dark,
  canEdit,
  q,
  archived,
  items: ilkCariler,
  total,
  nextCursor = null,
  editParty = null,
}: {
  slug: string;
  dark: boolean;
  canEdit: boolean;
  q: string;
  archived: boolean;
  items: readonly PartyView[];
  total: number | undefined;
  nextCursor?: string | null;
  /** T-1090: `?edit=` ile doğrudan açılan cari (kart ekranından Düzenle); sunucuda `getParty` ile okunur. */
  editParty?: PartyView | null;
}) {
  const t = useTranslations("parties");
  const tr = useTranslations("kural");
  const router = useRouter();
  const params = useSearchParams();
  const base = `/t/${encodeURIComponent(slug)}`;
  const list = `${base}/parties`;
  const listHref = `${list}${q === "" && !archived ? "" : `?${q === "" ? "" : `q=${encodeURIComponent(q)}`}${q !== "" && archived ? "&" : ""}${archived ? "arsiv=1" : ""}`}`;
  const [kind, setKind] = useState<Kind | "">("");
  const { say, node: toast } = useKalipToast("liste");
  const editId = params.get("edit");
  const isNew = params.get("new") === "1" && canEdit;
  // T-1058: kaydırınca eklenen sayfalar (sunucunun ilk sayfasının devamı); arama / arşiv değişince (yeni ilk sayfa) sıfırlanır.
  const [ek, setEk] = useState<{ readonly bas: readonly PartyView[]; readonly rows: readonly PartyView[]; readonly cursor: string | null }>({ bas: ilkCariler, rows: [], cursor: nextCursor });
  const guncel = ek.bas === ilkCariler ? ek : { bas: ilkCariler, rows: [], cursor: nextCursor };
  if (guncel !== ek) setEk(guncel);
  // Sonraki sayfalar arada kaymış olabilir: aynı cari iki kez çizilmez.
  const items = useMemo(() => {
    const ilk = new Set(ilkCariler.map((p) => p.id));
    return [...ilkCariler, ...guncel.rows.filter((r) => !ilk.has(r.id))];
  }, [ilkCariler, guncel.rows]);
  const sonrakiImlec = guncel.cursor;
  const dahaYukle = useCallback(async (): Promise<boolean> => {
    if (sonrakiImlec === null) return true;
    const r = await loadMorePartiesAction({ slug, q, archived, after: sonrakiImlec });
    if (!r.ok) return false;
    setEk((o) => (o.bas !== ilkCariler ? o : { bas: o.bas, rows: [...o.rows, ...r.data.items], cursor: r.data.nextCursor }));
    return true;
  }, [sonrakiImlec, slug, q, archived, ilkCariler]);
  // Kayda girip geri dönünce aynı uzunluk (sunucudan taze; yalnız sayı hatırlanır).
  useKalipDerinlik(items.length, sonrakiImlec !== null, dahaYukle);
  // Düzenleme aynı adreste (`?edit=`) açılır; sunucu yeniden çizince eklenen sayfalar sıfırlanır. Sonraki sayfadan açılan cari kaybolmasın diye
  // açılan satır burada tutulur (yalnız bu oturumun ekranda zaten gördüğü veri; kaydetme yine sunucuda sürüm denetimli).
  const [acilan, setAcilan] = useState<PartyView | null>(null);
  const editing = editId === null ? undefined : (items.find((p) => p.id === editId) ?? (acilan?.id === editId ? acilan : editParty?.id === editId ? editParty : undefined));

  const open = (p: PartyView | null): void => {
    feedback.minor();
    setAcilan(p);
    const sep = listHref.includes("?") ? "&" : "?";
    router.push(p === null ? `${listHref}${sep}new=1` : `${listHref}${sep}edit=${encodeURIComponent(p.id)}`);
  };
  // T-1048 (STANDART §2): ortak liste kalıbı — Kart / Liste, Sütunlar, sıralanan tablo.
  const [gorunum, setGorunum] = useKalipGorunum("parties");
  const sutunlar = useMemo<readonly KalipSutun<PartyView>[]>(
    () => [
      { id: "code", baslik: t("colCode"), sabit: true, deger: (p) => p.code, sirala: (p) => p.code },
      { id: "name", baslik: t("colName"), sabit: true, deger: (p) => <span className="ktad" title={p.name}>{p.name}</span>, sirala: (p) => p.name },
      { id: "kind", baslik: t("colKind"), deger: (p) => t(`kind.${p.kind}`), sirala: (p) => p.kind },
      { id: "city", baslik: t("colCity"), deger: (p) => p.city ?? "", sirala: (p) => p.city ?? "" },
      { id: "phone", baslik: t("colPhone"), deger: (p) => p.phone ?? "", sirala: (p) => p.phone ?? "" },
      { id: "email", baslik: t("colEmail"), varsayilan: false, deger: (p) => p.email ?? "", sirala: (p) => p.email ?? "" },
      { id: "tax", baslik: t("colTax"), varsayilan: false, deger: (p) => p.taxNo ?? "", sirala: (p) => p.taxNo ?? "" },
    ],
    [t],
  );
  const sutunSecim = useKalipSutunlar<PartyView>("parties", sutunlar);
  const close = (msg?: string): void => {
    router.push(listHref);
    if (msg !== undefined) say("ok", msg);
  };

  if (isNew || editing !== undefined) {
    return <PartyForm key={editing?.id ?? "new"} slug={slug} dark={dark} canEdit={canEdit} party={editing ?? null} onClose={close} />;
  }

  const shown = kind === "" ? items : items.filter((p) => p.kind === kind);
  const sayi = total !== undefined ? t("count", { n: total }) : sonrakiImlec === null ? t("count", { n: items.length }) : t("countMore", { n: items.length });
  const sonsuz = <KalipSonsuz devam={sonrakiImlec !== null} yukle={dahaYukle} metin={sayi} testId="parties-sonsuz" />;
  const chips: KalipCip[] = [
    { id: "active", label: t("chipActive"), d: LICON.grid, color: "172E42", on: !archived, href: q === "" ? list : `${list}?q=${encodeURIComponent(q)}` },
    { id: "archived", label: t("chipArchived"), d: LICON.lock, color: "4E6476", on: archived, href: `${list}?${q === "" ? "" : `q=${encodeURIComponent(q)}&`}arsiv=1` },
    ...KINDS.map((k) => ({ id: k, label: t(`kind.${k}`), d: KIND_VISUAL[k].d, color: KIND_VISUAL[k].color, on: kind === k, onClick: () => setKind((cur) => (cur === k ? "" : k)) })),
  ];

  return (
    <KalipEkran
      kind="liste"
      dark={dark}
      title={t("title")}
      icon={ICON}
      testId="parties"
      bar={{
        back: { href: base, aria: t("back") },
        homeNav: { href: base, aria: t("home") },
        main: canEdit ? { label: t("newShort"), aria: t("new"), d: LICON.plus, onClick: () => open(null), testId: "party-new" } : null,
      }}
      overlays={toast}
    >
      <KalipAra label={t("searchLabel")} placeholder={t("search")} action={list} defaultValue={q} below={archived ? <input type="hidden" name="arsiv" value="1" /> : null} inputProps={{ enterKeyHint: "search" }} />
      <div className="ktbar">
        <KalipCipler label={t("filter")} chips={chips} />
        <span className="kttools">
          {gorunum === "liste" ? <KalipSutunSec sutunlar={sutunlar} secim={sutunSecim} /> : null}
          <KalipGorunumSec value={gorunum} onChange={setGorunum} />
        </span>
      </div>
      {/* Tür çipi yüklenmiş satırları süzer; bulunamadıysa ve devamı varsa liste (ve sonundaki otomatik yükleme) açık kalır. */}
      {shown.length === 0 && sonrakiImlec === null ? (
        <>
          {q === "" && kind === "" && !archived ? (
            <KalipBos
              title={t("empty")}
              iconD={ICON.d}
              action={canEdit ? { label: t("firstParty"), kind: "add", onClick: () => open(null) } : { label: tr("home"), href: base, kind: "go" }}
            />
          ) : q === "" && kind === "" && archived ? (
            // T-1037: boş arşiv bir arama sonucu değildir — "Arşivde cari yok" + etkin carilere dön.
            <KalipBos title={t("archivedEmpty")} iconD={LICON.lock} action={{ label: t("chipActive"), href: list, kind: "go" }} />
          ) : (
            <KalipBos
              title={tr("notFoundSearch")}
              action={{ label: t("clear"), kind: "clear", ...(kind !== "" && q === "" && !archived ? { onClick: () => setKind("") } : { href: list }) }}
            />
          )}
        </>
      ) : (
        <>
          <KalipBaslik title={archived ? t("archivedList") : t("activeList")} hint={sayi} />
          {gorunum === "liste" ? (
            <KalipTablo<PartyView>
              label={t("title")}
              sutunlar={sutunSecim.gorunur}
              satirlar={shown}
              anahtar={(p) => p.id}
              href={(p) => `${list}/${encodeURIComponent(p.id)}`}
              satirAria={(p) => `${p.name} · ${p.code} · ${t(`kind.${p.kind}`)}`}
              testId="parties-table"
              sonu={sonsuz}
            />
          ) : (
          <KalipKartListe label={t("title")}>
            {shown.map((p, i) => {
              const v = KIND_VISUAL[p.kind];
              const meta = [t(`kind.${p.kind}`), p.city, p.phone, p.archived ? t("archived") : null].filter((x): x is string => x !== null && x !== "").join(" · ");
              return (
                <KalipKart key={p.id} index={i} name={p.name} code={p.code} meta={meta} d={v.d} color={v.color} href={`${list}/${encodeURIComponent(p.id)}`} aria={`${p.name} · ${p.code} · ${meta}`} testId="party-card">
                  <span hidden data-party={p.code} />
                </KalipKart>
              );
            })}
            {sonsuz}
          </KalipKartListe>
          )}
        </>
      )}
    </KalipEkran>
  );
}
