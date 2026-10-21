"use client";
// Ekibe katılma, yönetici tarafı (T-429, Ekip.dc.html "Onay bekliyor" + katılma QR'ı; T-971 LİSTE kalıbı, KalipListe.dc.html): bekleyen
// katılma talepleri `.ulist` kartları (REDDET / ONAYLA; ONAYLA kartı açar: kişinin telefonunda görünen 6 haneli kod + rol Toplayıcı /
// Sayımcı), PIN bekleyen onaylılar (İPTAL ET), katılma QR'ı kartı (7 gün; KAPAT / YAZDIR) + "Onaysız kimse giremez" notu. Ana işlem ortak
// alt çubukta QR OLUŞTUR / YENİLE (demo alanında kapalı). Güvenlik: QR adresi yalnız bu bileşenin belleğinde (yenile basılınca üretilir;
// eskisi o anda geçersiz); doğrulama kodu sayfaya gelmez, yönetici yazar. Bekleyen talepler 5 sn'de bir yenilenir.
// Bilinçli fark (T-971): ekran içi tema düğmesi yok (tema Hesap menüsünde).
// T-990 (ALTIN-KURAL): kapalı ana işlem ve karttaki ONAYLA sessiz kalmaz (hata sesi + neden balonu: demo / işlem sürüyor / kod eksik);
// onay kartında kod yazılmışken Geri / Ana ekran / bağlantılar ortak cam çıkış kutusunu açar (`useCikisKorumasi`).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { LICON } from "../../../../design/kalip-icons.ts";
import { useCikisKorumasi } from "../../kalip/cikis.tsx";
import { Ico, KalipBaslik, KalipEkran, tone, useKalipToast } from "../../kalip/ekran.tsx";
import { KalipBos, KalipKartListe } from "../../kalip/liste.tsx";
import { kdz } from "../../kalip/tokens.ts";
import { approveJoinAction, createJoinLinkAction, rejectJoinAction, revokeJoinLinkAction } from "../actions.ts";
import { Btn, ErrLine, Note, QrCode, type ErrState } from "../parts.tsx";
import { JoinShareRow } from "../join-share.tsx";

export interface JoinPending {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly deviceHint: string | null;
  readonly createdAt: string;
  readonly wrongTries: number;
}

export interface JoinApproved {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly decidedAt: string;
}

const c = (hex: string): string => kdz("dzl", hex);
const CARD: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10, cursor: "default", transform: "none" };
const HEAD: CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", alignItems: "center", gap: 12 };
const ROW: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };
const LBL: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, font: "800 10.5px/1.2 var(--font-bricolage), sans-serif", letterSpacing: ".08em" };
const HINT: CSSProperties = { margin: 0, fontSize: 12.5, opacity: 0.75 };

export function JoinView({
  dark,
  slug,
  tenantName,
  isDemo,
  link,
  pending,
  approved,
}: {
  dark: boolean;
  slug: string;
  tenantName: string;
  isDemo: boolean;
  link: { readonly expiresAt: string } | null;
  pending: readonly JoinPending[];
  approved: readonly JoinApproved[];
}) {
  const t = useTranslations("teamJoin");
  const format = useFormatter();
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(link?.expiresAt ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [role, setRole] = useState<"PICKER" | "COUNTER">("PICKER");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrState>(null);
  const { say, node: toast } = useKalipToast("liste");
  // T-986b: paylaşma satırı (WhatsApp, kopyala, PNG, yazdır). Ana işlem bu ekranda QR OLUŞTUR / YENİLE kalır (yenileme başka yerde yok).
  const rowRef = useRef<HTMLDivElement | null>(null);
  const returnTo = `/t/${slug}/members/join`;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  const fail = (detail: string | undefined, code_?: string): ErrState =>
    detail === "RECENT_AUTH_REQUIRED"
      ? { text: t("errReauth"), reauth: true }
      : detail === "DEMO"
        ? { text: t("errDemo"), reauth: false }
        : detail === "PLAN_LIMIT"
          ? { text: t("errPlan"), reauth: false }
          : code_ === "VERSION_CONFLICT"
            ? { text: t("errGone"), reauth: false }
            : { text: t("errServer"), reauth: false };
  const notify = (text: string): void => {
    tone("ok");
    say("ok", text);
  };

  async function newLink(): Promise<void> {
    setBusy(true);
    setErr(null);
    const r = await createJoinLinkAction({ slug });
    setBusy(false);
    if (!r.ok) {
      tone("err");
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    tone("ok");
    setUrl(r.data.url);
    setExpiresAt(r.data.expiresAt);
  }

  async function closeLink(): Promise<void> {
    setBusy(true);
    const r = await revokeJoinLinkAction({ slug });
    setBusy(false);
    if (!r.ok) {
      tone("err");
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    setUrl(null);
    setExpiresAt(null);
    notify(t("linkClosed"));
  }

  async function approve(id: string): Promise<void> {
    setBusy(true);
    setErr(null);
    const r = await approveJoinAction({ slug, requestId: id, code, roleKey: role });
    setBusy(false);
    if (!r.ok) {
      tone("err");
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    if (!r.data.ok) {
      tone("err");
      setErr({ text: r.data.issue === "CODE_WRONG" ? t("errCode") : t("errGone"), reauth: false });
      setCode("");
      router.refresh();
      return;
    }
    setOpen(null);
    setCode("");
    notify(t("approved", { username: r.data.username }));
    router.refresh();
  }

  async function reject(id: string): Promise<void> {
    setBusy(true);
    const r = await rejectJoinAction({ slug, requestId: id });
    setBusy(false);
    if (!r.ok) {
      tone("err");
      setErr(fail(r.error.detail, r.error.code));
      return;
    }
    setOpen(null);
    notify(t("rejected"));
    router.refresh();
  }

  const errLine = <ErrLine err={err} returnTo={returnTo} reauthLabel={t("reauthLink")} scope="dzl" />;
  const korunan = useCikisKorumasi(open !== null && code !== "", { dark, text: t("leaveText") });
  const approveOff = busy || code.length !== 6;
  const onApprove = (id: string): void => {
    if (approveOff) {
      tone("err");
      say("err", busy ? t("offBusy") : t("offCode"));
      return;
    }
    void approve(id);
  };

  return (
    <KalipEkran
      kind="liste"
      dark={dark}
      title={t("title")}
      subtitle={t("bandS", { tenant: tenantName.toLocaleUpperCase("tr-TR") })}
      icon={{ d: LICON.people, color: "6C4BD8" }}
      testId="team-join"
      bar={{
        back: { href: `/t/${slug}/members`, aria: t("back") },
        main: {
          label: expiresAt !== null ? t("renew") : t("create"),
          aria: t("qrKick"),
          d: LICON.plus,
          disabled: isDemo || busy,
          disabledReason: isDemo ? t("errDemo") : t("offBusy"),
          onClick: () => void newLink(),
          testId: "join-new",
        },
      }}
      overlays={
        <>
          {toast}
          {korunan.kutu}
        </>
      }
    >
      <KalipBaslik title={t("listTitle")} hint={t("listCount", { n: pending.length })} />
      {open === null ? errLine : null}
      {pending.length === 0 ? (
        <KalipBos title={t("empty")} iconD={LICON.people} testId="join-empty" />
      ) : (
        <KalipKartListe label={t("listTitle")}>
          {pending.map((p, i) => {
            const when = format.relativeTime(new Date(p.createdAt), now).toLocaleUpperCase("tr-TR");
            const isOpen = open === p.id;
            return (
              <div key={p.id} role="listitem" className="uc" style={{ ...CARD, animationDelay: `${i * 30}ms` }} data-testid="join-row">
                <div style={HEAD}>
                  <span className="uic" style={{ background: c("E56A00") }}>
                    <Ico d={LICON.people} size={26} />
                  </span>
                  <span className="ut">
                    <b>{p.name}</b>
                    <small className="mono">{`@${p.username} · ${p.deviceHint ?? t("phone")} · ${when}`}</small>
                  </span>
                </div>
                {!isOpen ? (
                  <div style={ROW}>
                    <Btn kind="soft" scope="dzl" d={LICON.close} onClick={() => void reject(p.id)} disabled={busy || isDemo} aria-label={t("rejectAria", { name: p.name })}>
                      {t("reject")}
                    </Btn>
                    <Btn
                      kind="ok"
                      scope="dzl"
                      d={LICON.check}
                      onClick={() => {
                        tone("tap");
                        setOpen(p.id);
                        setCode("");
                        setErr(null);
                      }}
                      disabled={busy || isDemo}
                      aria-label={t("approveAria", { name: p.name })}
                      data-testid="join-open"
                    >
                      {t("approve")}
                    </Btn>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <label style={LBL}>
                      {t("codeLabel")}
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={6}
                        placeholder="000000"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        style={{ minHeight: 56, borderRadius: 14, border: `2px solid ${c("C9D6E0")}`, background: c("FFFFFF"), color: c("172E42"), fontFamily: "var(--font-plex-mono), monospace", fontSize: 22, letterSpacing: ".3em", textAlign: "center" }}
                        data-testid="join-code-input"
                      />
                    </label>
                    <p style={HINT}>{p.wrongTries > 0 ? t("codeTries", { n: 3 - p.wrongTries }) : t("codeHint")}</p>
                    <div style={ROW} role="radiogroup" aria-label={t("roleLabel")}>
                      {(["PICKER", "COUNTER"] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          role="radio"
                          aria-checked={role === r}
                          className={`fch${role === r ? " on" : ""}`}
                          onClick={() => setRole(r)}
                          data-role={r}
                        >
                          <i style={{ background: c(r === "PICKER" ? "B85A14" : "2F5DA8") }}>
                            <Ico d={r === "PICKER" ? LICON.moveOut : LICON.clip} size={18} />
                          </i>
                          {t(`role.${r}`)}
                        </button>
                      ))}
                    </div>
                    {errLine}
                    <div style={ROW}>
                      <Btn kind="soft" scope="dzl" onClick={() => setOpen(null)} disabled={busy}>
                        {t("cancel")}
                      </Btn>
                      <Btn kind="ok" scope="dzl" d={LICON.check} onClick={() => onApprove(p.id)} aria-disabled={approveOff} style={approveOff ? { opacity: 0.5 } : undefined} data-testid="join-approve">
                        {t("approve")}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </KalipKartListe>
      )}

      {approved.length > 0 ? (
        <>
          <KalipBaslik title={t("approvedTitle")} hint={t("listCount", { n: approved.length })} />
          <KalipKartListe label={t("approvedTitle")}>
            {approved.map((a, i) => (
              <div key={a.id} role="listitem" className="uc" style={{ ...CARD, animationDelay: `${i * 30}ms` }} data-testid="join-approved-row">
                <div style={HEAD}>
                  <span className="uic" style={{ background: c("2F7D5B") }}>
                    <Ico d={LICON.clock} size={26} />
                  </span>
                  <span className="ut">
                    <b>{a.name}</b>
                    <small className="mono">{`@${a.username} · ${t("approvedHint")}`}</small>
                  </span>
                </div>
                <div>
                  <Btn kind="danger" scope="dzl" d={LICON.close} onClick={() => void reject(a.id)} disabled={busy || isDemo} aria-label={t("cancelApprovedAria", { name: a.name })}>
                    {t("cancelApproved")}
                  </Btn>
                </div>
              </div>
            ))}
          </KalipKartListe>
        </>
      ) : null}

      <section className="setup" aria-label={t("qrKick")} style={{ alignItems: "center", textAlign: "center", flex: "none" }} data-testid="join-qr-card">
        <b style={{ font: "800 13px/1 var(--font-bricolage), sans-serif", letterSpacing: ".1em" }}>{t("qrKick")}</b>
        {url !== null ? <QrCode value={url} label={t("qrLabel")} scope="dzl" size={240} testId="join-qr" /> : null}
        {expiresAt !== null ? (
          <span data-testid="join-expires" style={{ font: "800 15px/1 var(--font-bricolage), sans-serif", letterSpacing: ".06em" }}>
            {t("validUntil", { when: format.dateTime(new Date(expiresAt), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) })}
          </span>
        ) : null}
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.4, opacity: 0.85, maxWidth: 520 }}>{isDemo ? t("demoBody") : url !== null ? t("qrBody") : expiresAt !== null ? t("qrHidden") : t("qrNone")}</p>
        <div style={{ ...ROW, justifyContent: "center" }}>
          {!isDemo && expiresAt !== null ? (
            <Btn kind="soft" scope="dzl" d={LICON.close} onClick={() => void closeLink()} disabled={busy} data-testid="join-close">
              {t("close")}
            </Btn>
          ) : null}
        </div>
        <JoinShareRow url={url} tenantName={tenantName} isDemo={isDemo} say={say} dark={dark} rowRef={rowRef} />
        <Note d={LICON.lock} title={t("banTitle")} body={t("banBody")} />
      </section>
    </KalipEkran>
  );
}
