"use client";
// I-18 (DESIGN-PARITY): Giris.dc.html `v.mgr` bandı + `v.dev` (Cihazlar) BİREBİR: `.mgrid` içinde kayıtlı cihaz listesi (`.shd` + `.rows`,
// satırda İPTAL ET) ve sağda ortak cihaz ekleme kartı (`.kcard`: 5 dk QR + `.timer`; talep gelince "ONAY BEKLİYOR" durumu ONAYLA/REDDET) +
// "Onaysız cihaz giriş yapamaz" bandı (T-998 tasarım eki, kaynak 1792177264-a9d9). QR, kayıt belirtecini adresin `#` parçasında taşır
// (sunucuya/günlüğe gitmez); belirteç yalnız bu bileşenin belleğinde. Talep 3 sn'de bir sorgulanır; onay yalnız bu yöneticiden.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { create as createQr } from "qrcode";
import { DzRoot, useDz } from "../../../../design/dz-root.tsx";
import { C, dz } from "../../../../design/giris-tokens.ts";
import { GICON } from "../../../../design/giris-icons.ts";
import { approveEnrollmentAction, cancelEnrollmentAction, enrollmentStatusAction, revokeDeviceAction, startEnrollmentAction } from "../actions.ts";

export interface DeviceItem {
  readonly id: string;
  readonly kind: "PERSONAL" | "SHARED";
  readonly name: string;
  readonly owner: string | null;
  readonly lastUsedAt: string;
}

interface Enrollment {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: number;
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
    <div className="qr qrbig" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} aria-hidden="true" shapeRendering="crispEdges">
        {qr.cells.map((q) => (
          <rect key={`${q.x}-${q.y}`} x={q.x} y={q.y} width="1" height="1" fill={dz("172E42")} />
        ))}
      </svg>
    </div>
  );
}

function View({ slug, tenantName, devices }: { slug: string; tenantName: string; devices: readonly DeviceItem[] }) {
  const t = useTranslations("fieldDevices");
  const format = useFormatter();
  const { toggleTheme } = useDz();
  const router = useRouter();
  const [enr, setEnr] = useState<Enrollment | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; reauth: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const starting = useRef(false);
  // Çeviri işlevi her çizimde yeni olabilir; kayıt başlatma yalnız slug'a bağlı (yeni QR yalnız gerektiğinde).
  const tRef = useRef(t);
  tRef.current = t;
  const returnTo = `/t/${slug}/members/devices`;

  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setClaim(null);
    const r = await startEnrollmentAction({ slug });
    starting.current = false;
    if (r.ok) {
      setErr(null);
      setEnr({ id: r.data.enrollmentId, url: r.data.url, expiresAt: Date.parse(r.data.expiresAt) });
      return;
    }
    setEnr(null);
    setErr(r.error.detail === "RECENT_AUTH_REQUIRED" ? { text: tRef.current("errReauth"), reauth: true } : { text: tRef.current("errServer"), reauth: false });
  }, [slug]);

  useEffect(() => {
    void start();
  }, [start]);

  // Saat ve talep sorgusu (3 sn). Süre dolunca yeni QR.
  useEffect(() => {
    if (enr === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const poll = setInterval(() => {
      void enrollmentStatusAction({ slug, enrollmentId: enr.id }).then((r) => {
        if (!r.ok) return;
        if (r.data.state === "CLAIMED") setClaim(r.data.deviceName ?? "");
        else if (r.data.state === "EXPIRED" || r.data.state === "CANCELLED") void start();
      });
    }, 3000);
    return () => {
      clearInterval(timer);
      clearInterval(poll);
    };
  }, [enr, slug, start]);

  const left = enr === null ? 0 : Math.max(0, Math.floor((enr.expiresAt - now) / 1000));
  useEffect(() => {
    if (enr !== null && claim === null && left === 0) void start();
  }, [enr, claim, left, start]);

  async function approve(): Promise<void> {
    if (enr === null) return;
    setBusy(true);
    const r = await approveEnrollmentAction({ slug, enrollmentId: enr.id });
    setBusy(false);
    if (!r.ok) {
      setErr({ text: t("errServer"), reauth: false });
      void start();
      return;
    }
    setNotice(t("approved"));
    router.refresh();
    void start();
  }

  async function reject(): Promise<void> {
    if (enr === null) return;
    setBusy(true);
    await cancelEnrollmentAction({ slug, enrollmentId: enr.id });
    setBusy(false);
    void start();
  }

  async function revoke(d: DeviceItem): Promise<void> {
    setBusy(true);
    const r = await revokeDeviceAction({ slug, deviceId: d.id });
    setBusy(false);
    if (!r.ok) {
      setErr({ text: t("errServer"), reauth: false });
      return;
    }
    setNotice(t("revoked"));
    router.refresh();
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

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
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="shd">
                <b>{t("listTitle")}</b>
                <span>{t("listCount", { n: devices.length })}</span>
              </div>
              {notice !== null ? (
                <span className="hint ok" role="status">
                  <Ico d={GICON.check} size={16} />
                  {notice}
                </span>
              ) : null}
              <div className="rows">
                {devices.map((d) => {
                  const label = d.kind === "PERSONAL" && d.owner !== null ? `${d.owner} · ${d.name}` : d.name;
                  const when = format.relativeTime(new Date(d.lastUsedAt), now).toLocaleUpperCase("tr-TR");
                  return (
                    <div key={d.id} className="row" style={{ background: C.surface, cursor: "default" }} data-testid="device-row">
                      <span className="av" style={{ background: C.chip, color: C.fg }}>
                        <Ico d={d.kind === "SHARED" ? GICON.term : GICON.phone} size={24} />
                      </span>
                      <span className="rt">
                        <b>{label}</b>
                        <span>{`${d.kind === "SHARED" ? t("shared") : t("personal")} · ${t("lastUsed", { when })}`}</span>
                      </span>
                      <div className="rbtns">
                        <button type="button" className="sbtn" style={{ background: dz("C62828"), color: dz("FFFFFF") }} onClick={() => void revoke(d)} aria-label={t("revokeAria", { name: label })} disabled={busy}>
                          <Ico d={GICON.close} size={20} sw={2.8} />
                          <span className="tx">{t("revoke")}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {claim === null ? (
                <div className="kcard" style={{ background: C.surface }}>
                  <span className="kick">{t("addKick")}</span>
                  {enr !== null ? <Qr value={enr.url} label={t("qrLabel")} /> : null}
                  {enr !== null ? (
                    <span className="timer" role="timer">
                      {t("timer", { mm, ss })}
                    </span>
                  ) : null}
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
                  <p className="ls" style={{ margin: 0 }}>
                    {t("addBody")}
                  </p>
                </div>
              ) : (
                <div className="kcard" style={{ background: C.surface }}>
                  <span className="kick">{t("claimKick")}</span>
                  <span className="av" style={{ background: C.chip, color: C.fg, width: "72px", height: "72px", borderRadius: "22px" }}>
                    <Ico d={GICON.term} size={34} />
                  </span>
                  <b style={{ font: "800 24px/1.1 var(--font-bricolage), sans-serif" }}>{claim}</b>
                  <span className="chip" style={{ background: dz("F4B400"), color: dz("1A1300") }}>
                    {t("claimChip")}
                  </span>
                  <p className="ls" style={{ margin: 0 }}>
                    {t("claimBody")}
                  </p>
                  <div className="act" style={{ position: "static", padding: 0, boxShadow: "none", width: "100%" }}>
                    <button type="button" className="big ghost" style={{ background: C.chip, color: C.fg }} onClick={() => void reject()} disabled={busy}>
                      {t("reject")}
                    </button>
                    <button type="button" className="big" style={{ background: dz("17804F"), color: dz("FFFFFF") }} onClick={() => void approve()} disabled={busy}>
                      <Ico d={GICON.check} size={24} sw={3} />
                      {t("approve")}
                    </button>
                  </div>
                </div>
              )}
              <div className="ban" style={{ background: C.chip }}>
                <Ico d={GICON.lock} size={22} />
                <span>
                  <b>{t("banTitle")}</b>
                  {t("banBody")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DevicesView({ dark, slug, tenantName, devices }: { dark: boolean; slug: string; tenantName: string; devices: readonly DeviceItem[] }) {
  return (
    <DzRoot dark={dark} scope="dzg" testId="field-devices">
      <View slug={slug} tenantName={tenantName} devices={devices} />
    </DzRoot>
  );
}
