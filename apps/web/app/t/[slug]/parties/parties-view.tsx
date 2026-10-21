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
import { useState } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import type { AlanKurali } from "../kalip/dogrula.ts";
import { KalipBaslik, KalipEkran, tone, useKalipToast } from "../kalip/ekran.tsx";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup, KalipIzgara } from "../kalip/form.tsx";
import { KalipSecimGrubu } from "../kalip/secim.tsx";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { archivePartyAction, savePartyAction } from "./actions.ts";

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
const KIND_VISUAL: Record<Kind, { readonly d: string; readonly color: string }> = {
  CUSTOMER: { d: LICON.people, color: "2F7D5B" },
  SUPPLIER: { d: LICON.koli, color: "6C4BD8" },
  BOTH: { d: LICON.transfer, color: "0E7C7B" },
};
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
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const [initial] = useState<Form>(() => (party === null ? empty : fromParty(party)));
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string): void => setF((cur) => ({ ...cur, [k]: v }) as Form);
  const rules: AlanKurali[] = [
    { name: "code", label: t("f.code"), required: true, maxLength: 64 },
    { name: "name", label: t("f.name"), required: true, maxLength: 200 },
    { name: "kind", label: t("f.kind"), required: true },
    { name: "email", label: t("f.email"), kind: "email" },
  ];

  async function save(): Promise<KaydetSonuc> {
    const body = { slug, ...f, ...(party === null ? {} : { id: party.id, expectedVersion: party.version }) };
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
      tone("err");
      return;
    }
    tone("ok");
    onClose(party.archived ? t("restoredDone") : t("archivedDone"));
    router.refresh();
  }

  const field = (k: Exclude<keyof Form, "kind">, extra: { required?: boolean; maxLength?: number; inputMode?: "tel" | "email" } = {}) => (
    <KalipAlan
      key={k}
      label={`${t(`f.${k}`)}${extra.required === true ? " *" : ""}`}
      name={k}
      value={f[k]}
      onChange={(e) => set(k, e.target.value)}
      readOnly={!canEdit}
      maxLength={extra.maxLength}
      inputMode={extra.inputMode}
      autoComplete="off"
    />
  );
  const title = party === null ? t("new") : party.name;
  const v = KIND_VISUAL[f.kind];
  return (
    <KalipFormEkran
      dark={dark}
      title={title}
      icon={{ d: v.d, color: v.color }}
      subtitle={canEdit ? t("formHint") : t("readOnly")}
      testId="party-form"
      values={f}
      initial={initial}
      rules={rules}
      canEdit={canEdit}
      lockedTitle={t("readOnly")}
      lockedSub={t("readOnlySub")}
      onSave={save}
      onDone={() => {
        onClose(t("saved"));
        router.refresh();
      }}
      onBack={() => onClose()}
      homeHref={base}
      saveShort={t("saveShort")}
      saveAria={t("save")}
      savedText={t("saved")}
      leaveText={t("cf.text")}
      leaveSaveLabel={t("cf.save")}
      preview={<KalipOnizleme name={f.name} code={f.code} d={v.d} color={v.color} kind={t(`kind.${f.kind}`)} rows={[f.city, f.phone].filter((x) => x.trim() !== "").map((x, i) => ({ k: i === 0 && f.city.trim() !== "" ? t("f.city") : t("f.phone"), v: x }))} />}
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
      <KalipIzgara
        left={
          <KalipGrup title={t("gIdentity")} sub={t("gIdentitySub")} d={LICON.tag} color={v.color}>
            {field("code", { required: true, maxLength: 64 })}
            {field("name", { required: true, maxLength: 200 })}
            <KalipSecimGrubu
              name="kind"
              label={t("f.kind")}
              value={f.kind}
              color={v.color}
              disabled={!canEdit}
              onPick={(id) => set("kind", id)}
              options={KINDS.map((k) => ({ id: k, label: t(`kind.${k}`), d: KIND_VISUAL[k].d, color: KIND_VISUAL[k].color }))}
            />
          </KalipGrup>
        }
        right={
          <KalipGrup title={t("gContact")} sub={t("gContactSub")} d={LICON.info} color="2F5DA8">
            {field("taxNo", { inputMode: "tel" })}
            {field("taxOffice")}
            {field("phone", { inputMode: "tel" })}
            {field("email", { inputMode: "email" })}
            {field("city")}
            {field("address", { maxLength: 500 })}
          </KalipGrup>
        }
      />
    </KalipFormEkran>
  );
}

export function PartiesView({ slug, dark, canEdit, q, archived, items, total }: { slug: string; dark: boolean; canEdit: boolean; q: string; archived: boolean; items: readonly PartyView[]; total: number }) {
  const t = useTranslations("parties");
  const router = useRouter();
  const params = useSearchParams();
  const base = `/t/${encodeURIComponent(slug)}`;
  const list = `${base}/parties`;
  const listHref = `${list}${q === "" && !archived ? "" : `?${q === "" ? "" : `q=${encodeURIComponent(q)}`}${q !== "" && archived ? "&" : ""}${archived ? "arsiv=1" : ""}`}`;
  const [kind, setKind] = useState<Kind | "">("");
  const { say, node: toast } = useKalipToast("liste");
  const editId = params.get("edit");
  const isNew = params.get("new") === "1" && canEdit;
  const editing = editId === null ? undefined : items.find((p) => p.id === editId);

  const open = (p: PartyView | null): void => {
    tone("tap");
    const sep = listHref.includes("?") ? "&" : "?";
    router.push(p === null ? `${listHref}${sep}new=1` : `${listHref}${sep}edit=${encodeURIComponent(p.id)}`);
  };
  const close = (msg?: string): void => {
    router.push(listHref);
    if (msg !== undefined) say("ok", msg);
  };

  if (isNew || editing !== undefined) {
    return <PartyForm key={editing?.id ?? "new"} slug={slug} dark={dark} canEdit={canEdit} party={editing ?? null} onClose={close} />;
  }

  const shown = kind === "" ? items : items.filter((p) => p.kind === kind);
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
      <KalipCipler label={t("filter")} chips={chips} />
      {shown.length === 0 ? (
        <>
          <KalipBos
            title={q === "" && kind === "" ? t("empty") : t("noMatch")}
            {...(q === "" && kind === "" ? {} : { action: { label: t("clear"), ...(kind === "" ? { href: archived ? `${list}?arsiv=1` : list } : { onClick: () => setKind("") }) } })}
          />
          {canEdit ? (
            <KalipDaha href={`${base}/import`} iconD={LICON.excel} iconColor="1E7B45">
              {t("importLink")}
            </KalipDaha>
          ) : null}
        </>
      ) : (
        <>
          <KalipBaslik title={archived ? t("archivedList") : t("activeList")} hint={t("count", { n: total })} />
          <KalipKartListe label={t("title")}>
            {shown.map((p, i) => {
              const v = KIND_VISUAL[p.kind];
              const meta = [t(`kind.${p.kind}`), p.city, p.phone, p.archived ? t("archived") : null].filter((x): x is string => x !== null && x !== "").join(" · ");
              return (
                <KalipKart key={p.id} index={i} name={p.name} code={p.code} meta={meta} d={v.d} color={v.color} onClick={() => open(p)} aria={`${p.name} · ${p.code} · ${meta}`} testId="party-card">
                  <span hidden data-party={p.code} />
                </KalipKart>
              );
            })}
          </KalipKartListe>
        </>
      )}
    </KalipEkran>
  );
}
