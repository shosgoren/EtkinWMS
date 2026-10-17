"use client";
// I-18 (DESIGN-PARITY): Giris.dc.html `v.mgr` (bant) + `v.staff` (Saha personeli ekle) BİREBİR: `.mgrid` içinde form kartı (ad soyad,
// kullanıcı adı, görev `.opts`, depo `.opts`, PERSONELİ EKLE) ve sağda etkinleştirme kartı (`.kcard`: kod, QR, adres satırı, YAZDIR) +
// "Kod yalnız bu ekranda görünür" bandı; kod yokken "Personel nasıl girer?" bandı. Kod yalnız bu yanıtta ve bu bileşenin belleğinde
// (kaydedilmez, e-postayla gitmez). QR yalnız saha giriş adresini taşır (kod URL'ye girmez). Depo seçeneklerinde "Tüm depolar" eklidir
// (A-77: kapsam satırı yok = tüm depolar).
import { useMemo, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { create as createQr } from "qrcode";
import { DzRoot, useDz } from "../../../../design/dz-root.tsx";
import { C, dz } from "../../../../design/giris-tokens.ts";
import { GICON } from "../../../../design/giris-icons.ts";
import { useRouter } from "next/navigation";
import { createFieldUserAction, resetFieldCodeAction } from "../actions.ts";

interface Warehouse {
  readonly id: string;
  readonly name: string;
}

export interface StaffRow {
  readonly membershipId: string;
  readonly name: string;
  readonly username: string;
  readonly role: string;
  readonly active: boolean;
  readonly locked: boolean;
}

/** Kaynaktaki avatar tonları (`tone`). */
const TONES: readonly (readonly [string, string])[] = [
  ["FFE7A8", "4A3500"],
  ["CFE8DA", "0F3D27"],
  ["DCE4F8", "1C2E5C"],
  ["F6D9C9", "5C2410"],
];

interface Issued {
  readonly username: string;
  readonly code: string;
}

function Ico({ d, size, sw, style }: { d: string; size: number; sw?: number; style?: CSSProperties }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={sw === undefined ? style : { strokeWidth: sw, ...style }}>
      <path d={d} />
    </svg>
  );
}

function Qr({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => {
    try {
      const m = createQr(value, { errorCorrectionLevel: "M" }).modules;
      const cells: { x: number; y: number }[] = [];
      for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(y, x)) cells.push({ x, y });
      return { size: m.size, cells };
    } catch {
      return null;
    }
  }, [value]);
  if (qr === null) return null;
  return (
    <div className="qr" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} aria-hidden="true" shapeRendering="crispEdges">
        {qr.cells.map((q) => (
          <rect key={`${q.x}-${q.y}`} x={q.x} y={q.y} width="1" height="1" fill={dz("172E42")} />
        ))}
      </svg>
    </div>
  );
}

function Tick() {
  return (
    <span className="tick">
      <Ico d={GICON.check} size={16} sw={3.2} />
    </span>
  );
}

function View({ slug, host, tenantName, warehouses, staff }: { slug: string; host: string; tenantName: string; warehouses: readonly Warehouse[]; staff: readonly StaffRow[] }) {
  const t = useTranslations("fieldStaff");
  const { toggleTheme, dark } = useDz();
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"PICKER" | "COUNTER">("PICKER");
  const [wh, setWh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; reauth: boolean } | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const returnTo = `/t/${slug}/members/field`;

  function failText(code: string, detail: string | undefined): { text: string; reauth: boolean } {
    if (detail === "RECENT_AUTH_REQUIRED") return { text: t("errReauth"), reauth: true };
    if (detail === "CODE_TAKEN") return { text: t("errTaken"), reauth: false };
    if (detail === "PLAN_LIMIT") return { text: t("errPlan"), reauth: false };
    if (code === "VALIDATION_FAILED") return { text: t("errInvalid"), reauth: false };
    if (code === "FORBIDDEN") return { text: t("errForbidden"), reauth: false };
    return { text: t("errServer"), reauth: false };
  }

  async function newCode(row: StaffRow): Promise<void> {
    setBusy(true);
    setErr(null);
    const res = await resetFieldCodeAction({ slug, memberId: row.membershipId });
    setBusy(false);
    if (res.ok) {
      setIssued({ username: row.username, code: res.data.code });
      router.refresh();
      return;
    }
    setErr(failText(res.error.code, res.error.detail));
  }

  async function add(): Promise<void> {
    setBusy(true);
    setErr(null);
    const res = await createFieldUserAction({ slug, name: name.trim(), username: username.trim(), roleKey: role, warehouseId: wh });
    setBusy(false);
    if (res.ok) {
      // Kaynakta form değerleri kartla birlikte görünür kalır (kart hangi personele ait, ekranda okunur).
      setIssued({ username: res.data.username, code: res.data.code });
      router.refresh();
      return;
    }
    setErr(failText(res.error.code, res.error.detail));
    router.refresh();
  }

  const roleOpts = [
    { key: "PICKER" as const, t: t("rolePicker"), d: GICON.cikis, iBg: dz("F6D9C9"), iFg: dz("5C2410") },
    { key: "COUNTER" as const, t: t("roleCounter"), d: GICON.sayim, iBg: dz("DCE4F8"), iFg: dz("1C2E5C") },
  ];
  const whOpts: { id: string | null; t: string }[] = [{ id: null, t: t("allWarehouses") }, ...warehouses.map((w) => ({ id: w.id, t: w.name }))];
  const canAdd = !busy && name.trim().length >= 2 && username.trim().length >= 3;

  return (
    <div className="mp" style={{ background: C.bg, color: C.fg }}>
      <div className="band" style={{ background: dz("172E42") }}>
        <a className="wb" href={`/t/${slug}/members`} aria-label={t("back")}>
          <Ico d={GICON.back} size={26} sw={3} />
        </a>
        <div className="band-t">
          <b className="band-h">{t("bandH")}</b>
          <span className="band-s">{t("bandS", { tenant: tenantName.toLocaleUpperCase("tr-TR") })}</span>
        </div>
        <button type="button" className="wb" onClick={toggleTheme} aria-label={t("theme")}>
          <Ico d={GICON.theme} size={22} />
        </button>
      </div>
      <div className="lscroll wide">
        <div className="lin">
          <div className="mgrid">
            <div className="card" style={{ background: C.surface }}>
              <div className="fl">
                <label htmlFor="g-sn">{t("name")}</label>
                <div className="inp" style={{ background: C.chip }}>
                  <input id="g-sn" type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
              <div className="fl">
                <label htmlFor="g-su">{t("username")}</label>
                <div className="inp" style={{ background: C.chip }}>
                  <input id="g-su" type="text" autoCapitalize="none" spellCheck={false} value={username} maxLength={40} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <span className="hint">{t("usernameHint")}</span>
              </div>
              <div className="fl">
                <span className="fll">{t("role")}</span>
                <div className="opts" role="radiogroup" aria-label={t("roleLabel")}>
                  {roleOpts.map((ro) => (
                    <button
                      key={ro.key}
                      type="button"
                      role="radio"
                      aria-checked={role === ro.key}
                      className={`opt${role === ro.key ? " on" : ""}`}
                      style={{ background: C.chip, minHeight: "96px" }}
                      onClick={() => setRole(ro.key)}
                    >
                      <Tick />
                      <span className="oi" style={{ background: ro.iBg, color: ro.iFg }}>
                        <Ico d={ro.d} size={24} />
                      </span>
                      <b>{ro.t}</b>
                    </button>
                  ))}
                </div>
              </div>
              <div className="fl">
                <span className="fll">{t("warehouse")}</span>
                <div className="opts" role="radiogroup" aria-label={t("warehouseLabel")}>
                  {whOpts.map((wo) => (
                    <button
                      key={wo.id ?? "all"}
                      type="button"
                      role="radio"
                      aria-checked={wh === wo.id}
                      className={`opt${wh === wo.id ? " on" : ""}`}
                      style={{ background: C.chip, minHeight: "64px", justifyContent: "center" }}
                      onClick={() => setWh(wo.id)}
                    >
                      <Tick />
                      <b>{wo.t}</b>
                    </button>
                  ))}
                </div>
              </div>
              {err !== null ? (
                <span className="hint bad" role="alert">
                  <Ico d={GICON.warn} size={16} />
                  {err.text}
                  {err.reauth ? (
                    <a href={`/login?reauth=1&next=${encodeURIComponent(returnTo)}`} style={{ textDecoration: "underline", marginLeft: "6px" }}>
                      {t("reauthLink")}
                    </a>
                  ) : null}
                </span>
              ) : null}
              <button type="button" className="big" style={{ background: dz("172E42"), color: dz("FFFFFF"), flex: "none" }} onClick={() => void add()} disabled={!canAdd}>
                <Ico d={GICON.plus} size={24} sw={2.8} />
                {t("add")}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {issued !== null ? (
                <>
                  <div className="kcard" style={{ background: C.surface }}>
                    <span className="kick">{t("cardKick", { username: issued.username })}</span>
                    <span className="kcode" aria-label={t("codeLabel")}>
                      {issued.code}
                    </span>
                    <Qr value={`https://${host}/field`} label={t("qrLabel")} />
                    <span className="mono" style={{ fontSize: "13px", opacity: 0.8 }}>
                      {t("cardLine", { address: `${host}/${slug}` })}
                    </span>
                    <div className="act" style={{ position: "static", padding: 0, boxShadow: "none", width: "100%" }}>
                      <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg }} onClick={() => window.print()}>
                        <Ico d={GICON.print} size={22} />
                        {t("print")}
                      </button>
                    </div>
                  </div>
                  <div className="ban" style={{ background: C.chip }}>
                    <Ico d={GICON.lock} size={22} />
                    <span>
                      <b>{t("onceTitle")}</b>
                      {t("onceBody")}
                    </span>
                  </div>
                </>
              ) : (
                <div className="ban" style={{ background: C.chip }}>
                  <Ico d={GICON.clock} size={22} />
                  <span>
                    <b>{t("howTitle")}</b>
                    {t("howBody")}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="shd">
            <b>{t("listTitle")}</b>
            <span>{t("listCount", { n: staff.length })}</span>
          </div>
          <div className="rows">
            {staff.map((p, i) => {
              const tone = TONES[i % TONES.length] ?? ["FFE7A8", "4A3500"];
              const st = p.locked ? t("stLocked") : p.active ? t("stActive") : t("stPending");
              const stBg = p.locked ? dz("C62828") : p.active ? (dark ? dz("1F4A3A") : dz("CFE8DA")) : C.chip;
              const stFg = p.locked ? dz("FFFFFF") : p.active ? (dark ? dz("E6EAEE") : dz("0F3D27")) : C.fg;
              const roleText = p.role === "COUNTER" ? t("roleCounter") : t("rolePicker");
              return (
                <div key={p.membershipId} className="row" style={{ background: C.surface, cursor: "default" }} data-testid="field-staff-row">
                  <span className="av" style={{ background: dz(tone[0]), color: dz(tone[1]) }}>
                    {p.name.trim().charAt(0).toLocaleUpperCase("tr-TR")}
                  </span>
                  <span className="rt">
                    <b>{p.name}</b>
                    <span>{`${p.username} · ${roleText.toLocaleUpperCase("tr-TR")}`}</span>
                  </span>
                  <span className="chip" style={{ background: stBg, color: stFg }}>
                    {st}
                  </span>
                  <div className="rbtns">
                    <button type="button" className="sbtn" style={{ background: C.chip }} onClick={() => void newCode(p)} aria-label={t("newCodeAria", { name: p.name })} disabled={busy}>
                      <Ico d={GICON.renew} size={20} />
                      <span className="tx">{t("newCode")}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FieldStaffView({
  dark,
  slug,
  host,
  tenantName,
  warehouses,
  staff,
}: {
  dark: boolean;
  slug: string;
  host: string;
  tenantName: string;
  warehouses: readonly Warehouse[];
  staff: readonly StaffRow[];
}) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="field-staff">
      <View slug={slug} host={host} tenantName={tenantName} warehouses={warehouses} staff={staff} />
    </DzRoot>
  );
}
