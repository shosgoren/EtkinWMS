"use client";
// T-428: cari kartlar ekranı; T-971 (B-63, I-18): LİSTE kalıbı (KalipListe.dc.html) + düzenleme FORM kalıbı (KalipForm.dc.html).
// Liste: arama (sunucuda, GET `?q=`; arşiv görünümü `?arsiv=1`), süzgeç çipleri (Etkin / Arşivli adresi değiştirir; tür çipleri yüklenen
// listeyi süzer), cari kartları, boş durum + Excel'den aktar. Karta dokununca kart tam ekran form kalıbında açılır: kimlik grubu (kod, ünvan,
// tür seçenekleri) + vergi/iletişim grubu; ana işlem alt cam çubukta KAYDET (yalnız değişince etkin), Geri kaydedilmemiş işte uyarı kutusu
// (`KalipCikisUyarisi`) açar. Arşivle / arşivden çıkar formun altında. Yetki SUNUCUDADIR: `canEdit` yalnız gösterimdir.
// Bilinçli farklar (DESIGN-PARITY, T-971): çip sayıları yok (sunucu tür sayımı vermez); tür süzgeci yalnız yüklenen ≤100 kartı süzer.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipBaslik, KalipEkran, useKalipToast } from "../kalip/ekran.tsx";
import { KalipAlan, KalipCikisUyarisi, KalipGrup, KalipIzgara, KalipKilit, KalipSecenek, useLeaveGuard } from "../kalip/form.tsx";
import { KalipAra, KalipBos, KalipCipler, KalipDaha, KalipKart, KalipKartListe, type KalipCip } from "../kalip/liste.tsx";
import { archivePartyAction, savePartyAction } from "./actions.ts";
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
const KIND_VISUAL: Record<Kind, { readonly d: string; readonly color: string }> = {
  CUSTOMER: { d: LICON.people, color: "2F7D5B" },
  SUPPLIER: { d: LICON.koli, color: "6C4BD8" },
  BOTH: { d: LICON.transfer, color: "0E7C7B" },
};
const ICON = { d: LICON.people, color: "6C4BD8" } as const;

export function PartiesView({ slug, dark, canEdit, q, archived, items, total }: { slug: string; dark: boolean; canEdit: boolean; q: string; archived: boolean; items: readonly PartyView[]; total: number }) {
  const t = useTranslations("parties");
  const tr = useTranslations("kural");
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const list = `${base}/parties`;
  const [edit, setEdit] = useState<{ party: PartyView | null; form: Form; initial: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const [kind, setKind] = useState<Kind | "">("");
  const { say, node: toast } = useKalipToast("liste");
  const dirty = edit !== null && JSON.stringify(edit.form) !== JSON.stringify(edit.initial);
  useLeaveGuard(dirty);

  const open = (p: PartyView | null): void => {
    feedback.minor();
    const f = p === null ? empty : fromParty(p);
    setIssue(null);
    setEdit({ party: p, form: f, initial: f });
  };
  const close = (): void => {
    if (dirty) setAsk(true);
    else setEdit(null);
  };

  async function onSave(e?: FormEvent): Promise<void> {
    e?.preventDefault();
    if (edit === null || !canEdit || busy) return;
    setBusy(true);
    setIssue(null);
    const body = { slug, ...edit.form, ...(edit.party === null ? {} : { id: edit.party.id, expectedVersion: edit.party.version }) };
    const r = await savePartyAction(body);
    setBusy(false);
    if (!r.ok) {
      feedback.error();
      setAsk(false);
      setIssue(r.error.code === "VERSION_CONFLICT" ? t("conflict") : t("failed", { code: r.error.code }));
      return;
    }
    if (!r.data.ok) {
      feedback.error();
      setAsk(false);
      setIssue(t(`issue.${r.data.issue}`));
      return;
    }
    feedback.ok();
    setEdit(null);
    setAsk(false);
    say("ok", t("saved"));
    router.refresh();
  }

  async function onArchive(): Promise<void> {
    if (edit === null || edit.party === null) return;
    setBusy(true);
    const r = await archivePartyAction({ slug, id: edit.party.id, expectedVersion: edit.party.version, archived: !edit.party.archived });
    setBusy(false);
    if (!r.ok) {
      feedback.error();
      setIssue(r.error.code === "VERSION_CONFLICT" ? t("conflict") : t("failed", { code: r.error.code }));
      return;
    }
    if (edit.party.archived) say("ok", t("restoredDone"));
    else {
      // T-436 (ALTIN-KURAL 10): arşivleme geri dönüşlüdür — onay sorulmaz; birkaç saniye "Geri al" (sunucuda arşivden çıkarır).
      const id = edit.party.id;
      const version = r.data.version;
      feedback.undo(t("archivedDone"), tr("undo"), async () => {
        const u = await archivePartyAction({ slug, id, expectedVersion: version, archived: false });
        if (u.ok) feedback.ok(tr("undone"));
        else feedback.error(tr("undoFailed"));
        router.refresh();
      });
    }
    setEdit(null);
    router.refresh();
  }

  const set = (k: keyof Form, v: string): void => setEdit((cur) => (cur === null ? cur : { ...cur, form: { ...cur.form, [k]: v } as Form }));

  if (edit !== null) {
    const f = edit.form;
    const field = (k: Exclude<keyof Form, "kind">, extra: { required?: boolean; maxLength?: number; inputMode?: "tel" | "email" } = {}) => (
      <KalipAlan
        key={k}
        label={`${t(`f.${k}`)}${extra.required === true ? " *" : ""}`}
        name={k}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        readOnly={!canEdit}
        required={extra.required}
        maxLength={extra.maxLength}
        inputMode={extra.inputMode}
        autoComplete="off"
      />
    );
    const title = edit.party === null ? t("new") : edit.party.name;
    return (
      <KalipEkran
        kind="form"
        dark={dark}
        title={title}
        icon={{ d: KIND_VISUAL[f.kind].d, color: KIND_VISUAL[f.kind].color }}
        subtitle={canEdit ? t("formHint") : t("readOnly")}
        testId="party-form"
        bar={{
          back: { onClick: close, aria: t("back") },
          homeNav: { href: base, aria: t("home") },
          main: canEdit
            ? { label: t("saveShort"), aria: t("save"), d: LICON.check, onClick: () => void onSave(), disabled: busy || !dirty, testId: "party-save" }
            : { label: "", aria: t("readOnly"), d: LICON.lock, disabled: true },
        }}
        overlays={
          <KalipCikisUyarisi
            open={ask}
            text={t("cf.text")}
            saveLabel={t("cf.save")}
            onSave={canEdit ? () => void onSave() : undefined}
            onLeave={() => {
              setAsk(false);
              setEdit(null);
            }}
            onStay={() => setAsk(false)}
          />
        }
      >
        {canEdit ? null : <KalipKilit title={t("readOnly")} sub={t("readOnlySub")} />}
        <form onSubmit={(e) => void onSave(e)} aria-label={title} style={{ display: "contents" }}>
          <KalipIzgara
            left={
              <KalipGrup title={t("gIdentity")} sub={t("gIdentitySub")} d={LICON.tag} color={KIND_VISUAL[f.kind].color}>
                {field("code", { required: true, maxLength: 64 })}
                {field("name", { required: true, maxLength: 200 })}
                <KalipSecenek
                  label={t("f.kind")}
                  value={f.kind}
                  color={KIND_VISUAL[f.kind].color}
                  onPick={(id) => {
                    if (canEdit) set("kind", id);
                  }}
                  options={KINDS.map((k) => ({ id: k, label: t(`kind.${k}`), d: KIND_VISUAL[k].d }))}
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
          {issue !== null ? (
            <p role="alert" className="pill warn" style={{ margin: 0, alignSelf: "flex-start", whiteSpace: "normal" }}>
              {issue}
            </p>
          ) : null}
          {canEdit && edit.party !== null ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn n" disabled={busy} onClick={() => void onArchive()} data-testid="party-archive">
                {edit.party.archived ? t("restore") : t("archive")}
              </button>
            </div>
          ) : null}
          <button type="submit" className="sr" tabIndex={-1} aria-hidden="true">
            {t("save")}
          </button>
        </form>
      </KalipEkran>
    );
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
          {q === "" && kind === "" && !archived ? (
            <KalipBos
              title={t("empty")}
              iconD={ICON.d}
              action={canEdit ? { label: t("firstParty"), kind: "add", onClick: () => open(null) } : { label: tr("home"), href: base, kind: "go" }}
            />
          ) : (
            <KalipBos
              title={tr("notFoundSearch")}
              action={{ label: t("clear"), kind: "clear", ...(kind !== "" && q === "" && !archived ? { onClick: () => setKind("") } : { href: list }) }}
            />
          )}
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
