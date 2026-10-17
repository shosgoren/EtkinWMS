"use client";
// I-18 (DESIGN-PARITY): Yonet.dc.html `satis` BİREBİR (İÇERİK kartı: ANA BAŞLIK, VURGULU SATIR, ALT METİN, fiyat bölümü paket anahtarları,
// SON YAYIN satırı, Önizleme bağlantısı / Yayınla; sağda canlı önizleme `.lprev`; önizleme bağlantısı kutusu). Tasarım eki 1792181577-b73c.
// Önizleme ve yayın actions.ts'te (operatör + yakın zamanda doğrulama); metin kuralları domain + veritabanında.
import { useActionState, useState } from "react";
import { useDz } from "../../design/dz-root.tsx";
import { C, dz } from "../../design/yonet-tokens.ts";
import { YICON } from "../../design/yonet-icons.ts";
import { planLines, priceLabel } from "../plan-format.ts";
import type { SiteActionState } from "./actions.ts";

/** Paket (istemci dosyası sunucu paketini içe aktarmaz — T-127b). */
export interface SitePlanItem {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly limits: { readonly admins: number; readonly field: number; readonly warehouses: number; readonly items: number };
  readonly published: boolean;
  readonly recommended: boolean;
  /** Fiyat bölümünde gösterilsin mi (kayıtlı seçim). */
  readonly on: boolean;
}

export interface SatisLabels {
  readonly content: string;
  readonly host: string;
  readonly title1: string;
  readonly title2: string;
  readonly subtitle: string;
  readonly plans: string;
  readonly draftSuffix: string;
  readonly lastPub: string;
  readonly preview: string;
  readonly publish: string;
  readonly previewKick: string;
  readonly previewAria: string;
  readonly perMonth: string;
  readonly unlimited: string;
  readonly admins: string;
  readonly field: string;
  readonly warehouses: string;
  readonly items: string;
  readonly linkTitle: string;
  readonly linkBody: string;
  readonly copy: string;
  readonly copied: string;
  /** `{code}` yer tutuculu hata metni. */
  readonly error: string;
}

function Ico({ d, size }: { d: string; size: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function SatisView({
  initial,
  plans,
  published,
  labels: t,
  action,
}: {
  initial: { readonly title1: string; readonly title2: string; readonly subtitle: string };
  plans: readonly SitePlanItem[];
  /** "15.10 21:04 · SÜRÜM 3" ya da "HENÜZ YAYIN YOK". */
  published: string;
  labels: SatisLabels;
  action: (prev: SiteActionState, form: FormData) => Promise<SiteActionState>;
}) {
  const { dark } = useDz();
  const [state, formAction, pending] = useActionState(action, {});
  const [h, setH] = useState(initial.title1);
  const [h2, setH2] = useState(initial.title2);
  const [s, setS] = useState(initial.subtitle);
  const [show, setShow] = useState<readonly string[]>(plans.filter((p) => p.on).map((p) => p.id));
  const [copied, setCopied] = useState<string | null>(null);
  const cards = plans.filter((p) => p.published && show.includes(p.id));
  async function copy(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
    } catch {
      setCopied(null);
    }
  }
  return (
    <>
      {state.link !== undefined ? (
        <div className="ban" role="status" style={{ background: dz("FFE7A8"), color: dz("4A3500") }} data-testid="site-preview-link">
          <Ico d={YICON.link} size={22} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{t.linkTitle}</b>
            {t.linkBody}
            <span className="mono" style={{ display: "block", marginTop: "8px", fontSize: "13px", overflowWrap: "anywhere" }}>
              {state.link}
            </span>
          </span>
          <button type="button" className="btn sm" style={{ background: dz("4A3500"), color: dz("FFFFFF") }} onClick={() => void copy(state.link ?? "")}>
            {copied === state.link ? t.copied : t.copy}
          </button>
        </div>
      ) : null}
      {state.error !== undefined ? (
        <div className="ban" role="alert" style={{ background: dz("C62828"), color: dz("FFFFFF") }}>
          <span>{t.error.replace("{code}", state.error)}</span>
        </div>
      ) : null}
      <form className="grid2" action={formAction}>
        <input type="hidden" name="plans" value={JSON.stringify(show)} />
        <div className="card" style={{ background: C.surface }}>
          <div className="chd">
            <b>{t.content}</b>
            <span>{t.host}</span>
          </div>
          <div className="fl">
            <label htmlFor="y-h1">{t.title1}</label>
            <div className="inp" style={{ background: C.chip }}>
              <input id="y-h1" name="title1" type="text" maxLength={80} value={h} onChange={(e) => setH(e.target.value)} required />
            </div>
          </div>
          <div className="fl">
            <label htmlFor="y-h2">{t.title2}</label>
            <div className="inp" style={{ background: C.chip }}>
              <input id="y-h2" name="title2" type="text" maxLength={60} value={h2} onChange={(e) => setH2(e.target.value)} required />
            </div>
          </div>
          <div className="fl">
            <label htmlFor="y-sub">{t.subtitle}</label>
            <textarea id="y-sub" name="subtitle" className="ta" style={{ background: C.chip }} maxLength={400} value={s} onChange={(e) => setS(e.target.value)} required />
          </div>
          <span className="fll">{t.plans}</span>
          {plans.map((p) => {
            const on = show.includes(p.id) && p.published;
            return (
              <button
                key={p.id}
                type="button"
                className="tg"
                style={{ background: C.chip }}
                role="switch"
                aria-checked={on}
                onClick={() => setShow(show.includes(p.id) ? show.filter((x) => x !== p.id) : [...show, p.id])}
              >
                {p.published ? p.name : `${p.name}${t.draftSuffix}`}
                <span className={`sw${on ? " on" : ""}`} style={{ background: on ? dz("17804F") : dz(dark ? "3A4552" : "C9C3B8") }}>
                  <i />
                </span>
              </button>
            );
          })}
          <span className="kpi-s">{`${t.lastPub} · ${published}`}</span>
          <div className="sacts">
            <button type="submit" name="intent" value="PREVIEW" className="btn" style={{ background: C.chip }} disabled={pending}>
              {t.preview}
            </button>
            <button type="submit" name="intent" value="PUBLISH" className="btn" style={{ background: dz("17804F"), color: dz("FFFFFF") }} disabled={pending}>
              {t.publish}
            </button>
          </div>
        </div>
        <div className="lprev" aria-label={t.previewAria}>
          <span className="kpi-s" style={{ color: dz("F4C542"), opacity: 1 }}>
            {t.previewKick}
          </span>
          <h3>
            {h}{" "}
            <span style={{ display: "inline-block", padding: "0 .14em .04em", borderRadius: "10px", background: dz("F4C542"), color: dz("172E42") }}>{h2}</span>
          </h3>
          <p>{s}</p>
          <div className="lpk">
            {cards.map((p) => (
              <div key={p.id} className={`lpk-c${p.recommended ? " rec" : ""}`}>
                <b>{p.name}</b>
                <span>{`₺${priceLabel(p.price)} ${t.perMonth}`}</span>
                <small>{planLines(p, t).join(" · ")}</small>
              </div>
            ))}
          </div>
        </div>
      </form>
    </>
  );
}
