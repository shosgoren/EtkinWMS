"use client";
// Saha cihazları (T-998; T-971 LİSTE kalıbı, KalipListe.dc.html): üstte ortak cihaz ekleme kartı (5 dk QR + kalan süre; talep gelince
// "ONAY BEKLİYOR": terminaldeki 6 haneli kod + ONAYLA / REDDET) + "Onaysız cihaz giriş yapamaz" notu; otomatik durdurulan cihazlar dolu
// kırmızı kart (OTURUMLARI KAPAT); kayıtlı cihazlar `.ulist` kartları (İPTAL ET). Ana işlem ortak alt çubukta: talep yokken YENİ QR (eski
// kayıt iptal edilip yenisi üretilir), talep varken ONAYLA. Güvenlik: QR kayıt belirtecini adresin `#` parçasında taşır (sunucuya/günlüğe
// gitmez); belirteç yalnız bu bileşenin belleğinde. Talep 3 sn'de bir sorgulanır; süre dolunca yeni QR; onay yalnız bu yöneticiden.
// Bilinçli fark (T-971): ekran içi tema düğmesi yok (tema Hesap menüsünde).
// T-990 (ALTIN-KURAL): kapalı ONAYLA sessiz kalmaz (alt çubukta `disabledReason`; karttaki düğme dokununca hata sesi + neden balonu);
// kod yazılmışken Geri / Ana ekran / bağlantılar ortak cam çıkış kutusunu açar (`useCikisKorumasi`).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LICON } from "../../../../design/kalip-icons.ts";
import { useCikisKorumasi } from "../../kalip/cikis.tsx";
import { Ico, KalipBaslik, KalipEkran, tone, useKalipToast } from "../../kalip/ekran.tsx";
import { KalipBos, KalipKartListe } from "../../kalip/liste.tsx";
import { kdz } from "../../kalip/tokens.ts";
import { approveEnrollmentAction, cancelEnrollmentAction, enrollmentStatusAction, revokeDeviceAction, startEnrollmentAction } from "../actions.ts";
import { Btn, ErrLine, Note, QrCode, type ErrState } from "../parts.tsx";

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

const c = (hex: string): string => kdz("dzl", hex);
const CARD: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10, cursor: "default", transform: "none" };
const HEAD: CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", alignItems: "center", gap: 12 };
const BOX: CSSProperties = { alignItems: "center", textAlign: "center", flex: "none" };
const KICK: CSSProperties = { font: "800 13px/1 var(--font-bricolage), sans-serif", letterSpacing: ".1em" };
const BODY: CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.4, opacity: 0.85, maxWidth: 520 };

export function DevicesView({
  dark,
  slug,
  tenantName,
  devices,
  suspended,
}: {
  dark: boolean;
  slug: string;
  tenantName: string;
  devices: readonly DeviceItem[];
  suspended: readonly { readonly id: string; readonly name: string }[];
}) {
  const t = useTranslations("fieldDevices");
  const format = useFormatter();
  const router = useRouter();
  const [enr, setEnr] = useState<Enrollment | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [cc, setCc] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrState>(null);
  const { say, node: toast } = useKalipToast("liste");
  const starting = useRef(false);
  // Çeviri işlevi her çizimde yeni olabilir; kayıt başlatma yalnız slug'a bağlı (yeni QR yalnız gerektiğinde).
  const tRef = useRef(t);
  tRef.current = t;
  const returnTo = `/t/${slug}/members/devices`;

  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    setClaim(null);
    setCc("");
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
    const r = await approveEnrollmentAction({ slug, enrollmentId: enr.id, confirmCode: cc });
    setBusy(false);
    if (!r.ok) {
      tone("err");
      if (r.error.detail === "CODE_MISMATCH") {
        setErr({ text: t("errCode"), reauth: false });
        setCc("");
        return;
      }
      if (r.error.detail === "RECENT_AUTH_REQUIRED") {
        // T-414: cihaz onayı yeniden giriş ister; kayıt yeniden başlatılmaz, giriş bağlantısı gösterilir.
        setErr({ text: t("errReauth"), reauth: true });
        return;
      }
      setErr({ text: t("errServer"), reauth: false });
      void start();
      return;
    }
    setErr(null);
    tone("ok");
    say("ok", t("approved"));
    router.refresh();
    void start();
  }

  /** Reddet / YENİ QR: açık kayıt iptal edilir, yenisi üretilir. */
  async function reject(): Promise<void> {
    if (enr === null) {
      void start();
      return;
    }
    setBusy(true);
    await cancelEnrollmentAction({ slug, enrollmentId: enr.id });
    setBusy(false);
    void start();
  }

  async function closeSessions(deviceId: string): Promise<void> {
    setBusy(true);
    const r = await revokeDeviceAction({ slug, deviceId });
    setBusy(false);
    if (!r.ok) {
      tone("err");
      setErr(r.error.detail === "RECENT_AUTH_REQUIRED" ? { text: t("errReauth"), reauth: true } : { text: t("errServer"), reauth: false });
      return;
    }
    tone("ok");
    say("ok", t("sessionsClosed"));
  }

  async function revoke(d: DeviceItem): Promise<void> {
    setBusy(true);
    const r = await revokeDeviceAction({ slug, deviceId: d.id });
    setBusy(false);
    if (!r.ok) {
      tone("err");
      setErr(r.error.detail === "RECENT_AUTH_REQUIRED" ? { text: t("errReauth"), reauth: true } : { text: t("errServer"), reauth: false });
      return;
    }
    tone("ok");
    say("ok", t("revoked"));
    router.refresh();
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const errLine = <ErrLine err={err} returnTo={returnTo} reauthLabel={t("reauthLink")} scope="dzl" />;
  // Yarım iş: talep var ve kod yazılmaya başlanmış.
  const korunan = useCikisKorumasi(claim !== null && cc !== "", { dark, text: t("leaveText") });
  const offReason = busy ? t("offBusy") : t("offCode");
  const onApprove = (): void => {
    if (busy || cc.length !== 6) {
      tone("err");
      say("err", offReason);
      return;
    }
    void approve();
  };

  return (
    <KalipEkran
      kind="liste"
      dark={dark}
      title={t("title")}
      subtitle={t("bandS", { tenant: tenantName.toLocaleUpperCase("tr-TR") })}
      icon={{ d: LICON.key, color: "30475A" }}
      testId="field-devices"
      bar={{
        back: { href: `/t/${slug}/members`, aria: t("back") },
        main:
          claim === null
            ? {
                label: t("newQr"),
                d: LICON.plus,
                disabled: busy,
                disabledReason: t("offBusy"),
                onClick: () => {
                  tone("tap");
                  void reject();
                },
                testId: "devices-new-qr",
              }
            : { label: t("approve"), d: LICON.check, disabled: busy || cc.length !== 6, disabledReason: offReason, onClick: () => void approve(), wait: true, testId: "devices-approve" },
      }}
      overlays={
        <>
          {toast}
          {korunan.kutu}
        </>
      }
    >
      {suspended.map((d) => (
        <div key={d.id} className="uc crit" role="alert" style={CARD}>
          <div style={HEAD}>
            <span className="uic">
              <Ico d={LICON.warn} size={26} />
            </span>
            <span className="ut">
              <b>{t("suspendedTitle", { name: d.name })}</b>
              <small style={{ whiteSpace: "normal" }}>{t("suspendedBody")}</small>
            </span>
          </div>
          {/* İptal edilmiş cihazda oturum kapatma yeniden denenir (ALREADY yolu; inceleme n1/m2). */}
          <div>
            <Btn kind="soft" scope="dzl" d={LICON.lock} onClick={() => void closeSessions(d.id)} disabled={busy}>
              {t("closeSessions")}
            </Btn>
          </div>
        </div>
      ))}

      {claim === null ? (
        <section className="setup" aria-label={t("addKick")} style={BOX} data-testid="devices-qr-card">
          <b style={KICK}>{t("addKick")}</b>
          {enr !== null ? <QrCode value={enr.url} label={t("qrLabel")} scope="dzl" size={240} /> : null}
          {enr !== null ? (
            <span role="timer" style={{ font: "800 15px/1 var(--font-bricolage), sans-serif", letterSpacing: ".06em" }}>
              {t("timer", { mm, ss })}
            </span>
          ) : null}
          {errLine}
          <p style={BODY}>{t("addBody")}</p>
          <Note d={LICON.lock} title={t("banTitle")} body={t("banBody")} />
        </section>
      ) : (
        <section className="setup" aria-label={t("claimKick")} style={BOX} data-testid="devices-claim-card">
          <b style={KICK}>{t("claimKick")}</b>
          <span className="uic" style={{ background: c("30475A"), width: 72, height: 72, borderRadius: 22 }}>
            <Ico d={LICON.key} size={34} />
          </span>
          <b style={{ font: "800 24px/1.1 var(--font-bricolage), sans-serif" }}>{claim}</b>
          <span className="pill warn">{t("claimChip")}</span>
          <p style={BODY}>{t("claimBody")}</p>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 320, textAlign: "left", font: "800 10.5px/1 var(--font-bricolage), sans-serif", letterSpacing: ".1em" }}>
            {t("codeLabel")}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              placeholder="000000"
              value={cc}
              onChange={(e) => setCc(e.target.value.replace(/\D/g, ""))}
              style={{ minHeight: 56, borderRadius: 14, border: `2px solid ${c("C9D6E0")}`, background: c("FFFFFF"), color: c("172E42"), fontFamily: "var(--font-plex-mono), monospace", fontSize: 22, letterSpacing: ".3em", textAlign: "center" }}
            />
          </label>
          {errLine}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
            <Btn kind="soft" scope="dzl" d={LICON.close} onClick={() => void reject()} disabled={busy}>
              {t("reject")}
            </Btn>
            <Btn kind="ok" scope="dzl" d={LICON.check} onClick={onApprove} aria-disabled={busy || cc.length !== 6} style={busy || cc.length !== 6 ? { opacity: 0.5 } : undefined}>
              {t("approve")}
            </Btn>
          </div>
          <Note d={LICON.lock} title={t("banTitle")} body={t("banBody")} />
        </section>
      )}

      <KalipBaslik title={t("listTitle")} hint={t("listCount", { n: devices.length })} />
      {devices.length === 0 ? (
        <KalipBos title={t("empty")} iconD={LICON.key} />
      ) : (
        <KalipKartListe label={t("listTitle")}>
          {devices.map((d, i) => {
            const label = d.kind === "PERSONAL" && d.owner !== null ? `${d.owner} · ${d.name}` : d.name;
            const when = format.relativeTime(new Date(d.lastUsedAt), now).toLocaleUpperCase("tr-TR");
            return (
              <div key={d.id} role="listitem" className="uc" style={{ ...CARD, animationDelay: `${i * 30}ms` }} data-testid="device-row">
                <div style={HEAD}>
                  <span className="uic" style={{ background: c(d.kind === "SHARED" ? "30475A" : "2F5DA8") }}>
                    <Ico d={d.kind === "SHARED" ? LICON.key : LICON.people} size={26} />
                  </span>
                  <span className="ut">
                    <b title={label}>{label}</b>
                    <small className="mono">{`${d.kind === "SHARED" ? t("shared") : t("personal")} · ${t("lastUsed", { when })}`}</small>
                  </span>
                </div>
                <div>
                  <Btn kind="danger" scope="dzl" d={LICON.close} onClick={() => void revoke(d)} aria-label={t("revokeAria", { name: label })} disabled={busy}>
                    {t("revoke")}
                  </Btn>
                </div>
              </div>
            );
          })}
        </KalipKartListe>
      )}
    </KalipEkran>
  );
}
