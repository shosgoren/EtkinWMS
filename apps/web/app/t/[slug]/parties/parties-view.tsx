"use client";
// T-428: cari kartlar ekranı. Tasarım kaynağı yok (DESIGN-PARITY: "tasarım kaynağı yok" satırı); alt ekran standardıyla Aktar kabuğunun kendi
// sınıflarıyla kurulur: üst çubuk (`.top`), liste satırı (`.colb`), düzenleme penceresi (`.scrim > .sheet`), alt cam çubuk Geri + Ana ekran · YENİ CARİ.
// Kaydedilmemiş form kapatılırken cam kutuyla sorulur. Excel'den aktarım Aktar ekranından (Cari kartlar).
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties, type FormEvent } from "react";
import { dz } from "../../../design/aktar-tokens.ts";
import { AICON } from "../../../design/aktar-icons.ts";
import { archivePartyAction, savePartyAction } from "./actions.ts";
import { KabukBar } from "../kabuk/kabuk-bar.tsx";

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

type Form = Record<"code" | "name" | "taxNo" | "taxOffice" | "phone" | "email" | "city" | "address", string> & { kind: PartyView["kind"] };
const empty: Form = { code: "", name: "", kind: "CUSTOMER", taxNo: "", taxOffice: "", phone: "", email: "", city: "", address: "" };
const fromParty = (p: PartyView): Form => ({ code: p.code, name: p.name, kind: p.kind, taxNo: p.taxNo ?? "", taxOffice: p.taxOffice ?? "", phone: p.phone ?? "", email: p.email ?? "", city: p.city ?? "", address: p.address ?? "" });
const KIND_COLOR = { CUSTOMER: "2F7D5B", SUPPLIER: "6C4BD8", BOTH: "0E7C7B" } as const;

function Ico({ d, size }: { d: readonly string[] | string; size: number }) {
  const list = typeof d === "string" ? [d] : d;
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {list.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

export function PartiesView({ slug, dark, canEdit, q, archived, items, total }: { slug: string; dark: boolean; canEdit: boolean; q: string; archived: boolean; items: readonly PartyView[]; total: number }) {
  const t = useTranslations("parties");
  const router = useRouter();
  const base = `/t/${encodeURIComponent(slug)}`;
  const [edit, setEdit] = useState<{ party: PartyView | null; form: Form; initial: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const dirty = edit !== null && JSON.stringify(edit.form) !== JSON.stringify(edit.initial);

  const open = (p: PartyView | null): void => {
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
    if (edit === null) return;
    setBusy(true);
    setIssue(null);
    const body = { slug, ...edit.form, ...(edit.party === null ? {} : { id: edit.party.id, expectedVersion: edit.party.version }) };
    const r = await savePartyAction(body);
    setBusy(false);
    if (!r.ok) {
      setIssue(r.error.code === "VERSION_CONFLICT" ? t("conflict") : t("failed", { code: r.error.code }));
      return;
    }
    if (!r.data.ok) {
      setIssue(t(`issue.${r.data.issue}`));
      return;
    }
    setEdit(null);
    setAsk(false);
    router.refresh();
  }

  async function onArchive(): Promise<void> {
    if (edit === null || edit.party === null) return;
    setBusy(true);
    const r = await archivePartyAction({ slug, id: edit.party.id, expectedVersion: edit.party.version, archived: !edit.party.archived });
    setBusy(false);
    if (!r.ok) {
      setIssue(r.error.code === "VERSION_CONFLICT" ? t("conflict") : t("failed", { code: r.error.code }));
      return;
    }
    setEdit(null);
    router.refresh();
  }

  const set = (k: keyof Form, v: string): void => setEdit((cur) => (cur === null ? cur : { ...cur, form: { ...cur.form, [k]: v } as Form }));

  return (
    <>
    <div className={`dza${dark ? " dz-dark" : ""}`} data-testid="parties">
      <div className="wrap">
        <div className="appzone">
          <div className="app">
            <header className="top">
              <span className="brand">
                <span className="alic" style={{ background: dz("6C4BD8"), width: 44, height: 44, borderRadius: 14, flex: "none" }}>
                  <Ico d={[AICON.cariA, AICON.cariB]} size={22} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <b>{t("title")}</b>
                  <small>{t("sub", { n: total })}</small>
                </span>
              </span>
            </header>

            <main className="inner">
              <form className="psearch" role="search" action={`${base}/parties`} method="get">
                <input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} type="search" enterKeyHint="search" />
                {archived ? <input type="hidden" name="arsiv" value="1" /> : null}
                <button type="submit" className="btn n" style={{ minHeight: 52 }}>
                  {t("find")}
                </button>
              </form>
              <div className="shd">
                <b>{archived ? t("archivedList") : t("activeList")}</b>
                <span>
                  <a href={archived ? `${base}/parties` : `${base}/parties?arsiv=1`} style={{ color: "inherit" }}>
                    {archived ? t("showActive") : t("showArchived")}
                  </a>
                </span>
              </div>
              <div className="plist" role="list" aria-label={t("title")}>
                {items.length === 0 ? (
                  <div className="memo">
                    <span className="mic" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                      <Ico d={AICON.bulb} size={18} />
                    </span>
                    <span>
                      {q === "" ? t("empty") : t("noMatch")}{" "}
                      {canEdit ? (
                        <a href={`${base}/import`} style={{ color: "inherit", fontWeight: 800 }}>
                          {t("importLink")}
                        </a>
                      ) : null}
                    </span>
                  </div>
                ) : null}
                {items.map((p) => (
                  <button key={p.id} type="button" role="listitem" className="colb" onClick={() => open(p)} data-party={p.code} style={p.archived ? ({ opacity: 0.6 } as CSSProperties) : undefined}>
                    <span className="cl" style={{ background: dz(KIND_COLOR[p.kind]), color: dz("FFFFFF") }}>
                      {(p.name.trim()[0] ?? "?").toLocaleUpperCase("tr")}
                    </span>
                    <span className="kt" style={{ minWidth: 0 }}>
                      <b>{p.name}</b>
                      <small>{[p.code, t(`kind.${p.kind}`), p.city, p.phone].filter((x) => x !== null && x !== "").join(" · ")}</small>
                    </span>
                    <span className="cu">{p.archived ? t("archived") : ""}</span>
                  </button>
                ))}
              </div>
            </main>


            {edit !== null ? (
              <div className="scrim" onClick={close}>
                <section className="sheet" role="dialog" aria-label={edit.party === null ? t("new") : edit.party.name} onClick={(e) => e.stopPropagation()}>
                  <div className="sh">
                    <span>
                      <b>{edit.party === null ? t("new") : edit.party.name}</b>
                      <small>{canEdit ? t("formHint") : t("readOnly")}</small>
                    </span>
                    <button type="button" className="x" aria-label={t("close")} onClick={close}>
                      <Ico d={AICON.close} size={18} />
                    </button>
                  </div>
                  <form className="pform" onSubmit={(e) => void onSave(e)}>
                    {(["code", "name"] as const).map((k) => (
                      <label key={k} className="pf">
                        <span>{t(`f.${k}`)} *</span>
                        <input value={edit.form[k]} onChange={(e) => set(k, e.target.value)} required readOnly={!canEdit} maxLength={k === "code" ? 64 : 200} name={k} />
                      </label>
                    ))}
                    <label className="pf">
                      <span>{t("f.kind")}</span>
                      <select value={edit.form.kind} onChange={(e) => set("kind", e.target.value)} disabled={!canEdit} name="kind">
                        {(["CUSTOMER", "SUPPLIER", "BOTH"] as const).map((k) => (
                          <option key={k} value={k}>
                            {t(`kind.${k}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(["taxNo", "taxOffice", "phone", "email", "city"] as const).map((k) => (
                      <label key={k} className="pf">
                        <span>{t(`f.${k}`)}</span>
                        <input value={edit.form[k]} onChange={(e) => set(k, e.target.value)} readOnly={!canEdit} name={k} inputMode={k === "taxNo" || k === "phone" ? "tel" : k === "email" ? "email" : undefined} />
                      </label>
                    ))}
                    <label className="pf wide">
                      <span>{t("f.address")}</span>
                      <input value={edit.form.address} onChange={(e) => set("address", e.target.value)} readOnly={!canEdit} name="address" maxLength={500} />
                    </label>
                    {issue !== null ? (
                      <p role="alert" className="wide" style={{ margin: 0, color: dz("C62828"), fontWeight: 800 }}>
                        {issue}
                      </p>
                    ) : null}
                    {canEdit ? (
                      <div className="wide" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="submit" className="btn y" style={{ minHeight: 52, padding: "0 22px" }} disabled={busy} data-testid="party-save">
                          {busy ? t("saving") : t("save")}
                        </button>
                        {edit.party !== null ? (
                          <button type="button" className="btn n" style={{ minHeight: 52, padding: "0 22px" }} disabled={busy} onClick={() => void onArchive()}>
                            {edit.party.archived ? t("restore") : t("archive")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </form>
                </section>
              </div>
            ) : null}

            {ask ? (
              <>
                <div className="cfback" onClick={() => setAsk(false)} />
                <div className="cfbox" role="alertdialog" aria-label={t("cf.title")}>
                  <span className="cfic">
                    <Ico d={AICON.warn} size={26} />
                  </span>
                  <b>{t("cf.title")}</b>
                  <p>{t("cf.text")}</p>
                  <button type="button" className="cfb save" onClick={() => void onSave()}>
                    <Ico d={AICON.check} size={20} />
                    {t("cf.save")}
                  </button>
                  <button
                    type="button"
                    className="cfb leave"
                    onClick={() => {
                      setAsk(false);
                      setEdit(null);
                    }}
                  >
                    <Ico d={AICON.signOut} size={20} />
                    {t("cf.leave")}
                  </button>
                  <button type="button" className="cfb stay" onClick={() => setAsk(false)}>
                    {t("cf.stay")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
    {/* T-958: ortak alt cam çubuk (Kabuk.dc.html): Geri · Ana ekran · ekranın ana işlemi · Modüller · Etkin. */}
    <KabukBar
      dark={dark}
      back={{ href: base, aria: t("back") }}
      homeNav={{ href: base, aria: t("home") }}
      main={canEdit ? { label: t("newShort"), aria: t("new"), d: AICON.plus, onClick: () => open(null), testId: "party-new" } : null}
    />
    </>
  );
}
