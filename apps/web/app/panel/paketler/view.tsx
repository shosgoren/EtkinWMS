"use client";
// I-18 (DESIGN-PARITY): Yonet.dc.html `paketler` BİREBİR (bant, paket kartları `.pk-grid`, "PAKETİ DÜZENLE" formu, özellik ve yayın
// anahtarları, iki kayıt düğmesi). Kartlar gerçek veridir (wms_platform.plans, güncel sürüm; müşteri sayısı abonelikten). Kayıt
// actions.ts'te (operatör + yakın zamanda doğrulama, veritabanı işlevi); fiyat/sınır/özellik değişikliği yeni sürüm açar.
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useDz } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/yonet-tokens.ts";
import { YICON } from "../../design/yonet-icons.ts";
import type { PlanActionState } from "./actions.ts";
import { planLines, priceLabel } from "../plan-format.ts";

/** Paket (sunucudaki `PlanRow` ile aynı biçim; istemci dosyası sunucu paketini içe aktarmaz — T-127b). */
export interface PlanItem {
  readonly id: string | null;
  readonly name: string;
  readonly price: string;
  readonly limits: { readonly admins: number; readonly field: number; readonly warehouses: number; readonly items: number };
  readonly features: { readonly qr: boolean; readonly ship: boolean; readonly prod: boolean; readonly api: boolean };
  readonly published: boolean;
  readonly recommended: boolean;
  readonly customers: number;
}

export interface PaketlerLabels {
  readonly banTitle: string;
  readonly banBody: string;
  readonly published: string;
  readonly draft: string;
  readonly recommended: string;
  readonly perMonth: string;
  readonly customers: string;
  readonly unlimited: string;
  readonly admins: string;
  readonly field: string;
  readonly warehouses: string;
  readonly items: string;
  readonly edit: string;
  readonly name: string;
  readonly price: string;
  readonly priceSuffix: string;
  readonly limAdmins: string;
  readonly limField: string;
  readonly limWarehouses: string;
  readonly limItems: string;
  readonly atMost: string;
  readonly unlimitedSuffix: string;
  readonly features: string;
  readonly fQr: string;
  readonly fShip: string;
  readonly fProd: string;
  readonly fApi: string;
  readonly publish: string;
  readonly fPublish: string;
  readonly fRecommended: string;
  readonly saveDraft: string;
  readonly savePublish: string;
  /** `{code}` yer tutuculu hata metni. */
  readonly error: string;
}

function Ico({ d, size, sw }: { d: string; size: number; sw?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? undefined : { strokeWidth: sw }}>
      <path d={d} />
    </svg>
  );
}

function Switch({ label, on, onToggle, dark }: { label: string; on: boolean; onToggle: () => void; dark: boolean }) {
  return (
    <button type="button" className="tg" style={{ background: C.chip }} role="switch" aria-checked={on} onClick={onToggle}>
      {label}
      <span className={`sw${on ? " on" : ""}`} style={{ background: on ? dz("17804F") : dz(dark ? "3A4552" : "C9C3B8") }}>
        <i />
      </span>
    </button>
  );
}

export function PaketlerView({
  plans,
  selected,
  labels: t,
  action,
}: {
  plans: readonly PlanItem[];
  /** Düzenlenen paketin sırası (`plans` içinde). */
  selected: number;
  labels: PaketlerLabels;
  action: (prev: PlanActionState, form: FormData) => Promise<PlanActionState>;
}) {
  const router = useRouter();
  const { dark } = useDz();
  const ep = plans[selected] ?? plans[0];
  const [state, formAction, pending] = useActionState(action, {});
  const [feat, setFeat] = useState(ep?.features ?? { qr: true, ship: false, prod: false, api: false });
  const [pub, setPub] = useState(ep?.published ?? false);
  const [rec, setRec] = useState(ep?.recommended ?? false);
  const [lim, setLim] = useState(ep?.limits ?? { admins: 1, field: 1, warehouses: 1, items: 100 });
  const [name, setName] = useState(ep?.name ?? "");
  if (ep === undefined) return null;
  const select = (p: PlanItem, i: number): void => {
    router.push(p.id === null ? "/paketler?yeni=1" : `/paketler?p=${encodeURIComponent(p.id)}`);
    void i;
  };
  const limitRows = [
    ["y-l1", t.limAdmins, "admins"],
    ["y-l2", t.limField, "field"],
    ["y-l3", t.limWarehouses, "warehouses"],
    ["y-l4", t.limItems, "items"],
  ] as const;
  return (
    <>
      <div className="ban" style={{ background: C.chip }}>
        <Ico d={YICON.clock} size={22} />
        <span>
          <b>{t.banTitle}</b>
          {t.banBody}
        </span>
      </div>
      {state.error !== undefined ? (
        <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
          <span>{t.error.replace("{code}", state.error)}</span>
        </div>
      ) : null}
      <div className="pk-grid">
        {plans.map((p, i) => (
          <button key={p.id ?? "yeni"} type="button" className={`pk${i === selected ? " sel" : ""}`} style={{ background: C.surface }} onClick={() => select(p, i)} aria-pressed={i === selected}>
            <div className="pk-tags">
              <span className="chip" style={p.published ? { background: C["ok-bg"], color: C["ok-fg"] } : { background: C.chip, color: C.fg }}>
                {p.published ? t.published : t.draft}
              </span>
              {p.recommended ? (
                <span className="chip" style={{ background: dz("F4C542"), color: dz("1A1300") }}>
                  {t.recommended}
                </span>
              ) : null}
            </div>
            <span className="pk-n">{p.name}</span>
            <span className="pk-p">
              ₺{priceLabel(p.price)}
              <small>{t.perMonth}</small>
            </span>
            <ul className="pk-l">
              {planLines(p, t).map((l) => (
                <li key={l}>
                  <Ico d={YICON.check} size={16} sw={3} />
                  {l}
                </li>
              ))}
            </ul>
            <span className="kpi-s">{t.customers.replace("{n}", String(p.customers))}</span>
          </button>
        ))}
      </div>
      <form className="card" style={{ background: C.surface }} action={formAction} key={ep.id ?? "yeni"}>
        <input type="hidden" name="id" value={ep.id ?? ""} />
        <input type="hidden" name="features" value={JSON.stringify(feat)} />
        <input type="hidden" name="recommended" value={rec ? "1" : "0"} />
        <input type="hidden" name="published" value={pub ? "1" : "0"} />
        <div className="chd">
          <b>{`${t.edit} · ${name}`}</b>
          <span>{ep.published ? t.published : t.draft}</span>
        </div>
        <div className="form">
          <div className="fl">
            <label htmlFor="y-pn">{t.name}</label>
            <div className="inp" style={{ background: C.chip }}>
              <input id="y-pn" name="name" type="text" defaultValue={ep.name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
            </div>
          </div>
          <div className="fl">
            <label htmlFor="y-pp">{t.price}</label>
            <div className="inp" style={{ background: C.chip }}>
              <input id="y-pp" name="price" type="text" inputMode="numeric" defaultValue={ep.price} required />
              <span className="suf">{t.priceSuffix}</span>
            </div>
          </div>
          {limitRows.map(([id, label, key]) => (
            <div className="fl" key={id}>
              <label htmlFor={id}>{label}</label>
              <div className="inp" style={{ background: C.chip }}>
                <input
                  id={id}
                  name={`lim_${key}`}
                  type="text"
                  inputMode="numeric"
                  value={String(lim[key])}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value.replace(/\D/g, ""), 10);
                    setLim({ ...lim, [key]: Number.isNaN(n) ? 0 : n });
                  }}
                />
                <span className="suf">{lim[key] === 0 ? t.unlimitedSuffix : t.atMost}</span>
              </div>
            </div>
          ))}
          <div className="fl full">
            <span className="fll">{t.features}</span>
          </div>
          {(
            [
              ["qr", t.fQr],
              ["ship", t.fShip],
              ["prod", t.fProd],
              ["api", t.fApi],
            ] as const
          ).map(([k, l]) => (
            <Switch key={k} label={l} on={feat[k]} dark={dark} onToggle={() => setFeat({ ...feat, [k]: !feat[k] })} />
          ))}
          <div className="fl full">
            <span className="fll">{t.publish}</span>
          </div>
          <Switch label={t.fPublish} on={pub} dark={dark} onToggle={() => setPub(!pub)} />
          <Switch label={t.fRecommended} on={rec} dark={dark} onToggle={() => setRec(!rec)} />
        </div>
        <div className="sacts">
          <button type="submit" name="intent" value="DRAFT" className="btn" style={{ background: C.chip }} disabled={pending}>
            {t.saveDraft}
          </button>
          <button type="submit" name="intent" value="PUBLISH" className="btn" style={{ background: dz("17804F"), color: dz("FFFFFF") }} disabled={pending}>
            <Ico d={YICON.check} size={18} sw={3} />
            {t.savePublish}
          </button>
        </div>
      </form>
    </>
  );
}
