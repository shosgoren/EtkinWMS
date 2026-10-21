"use client";
// Davet penceresi + tek seferlik bağlantı kutusu + sunucu hatası gösterimi (T-119). Düz bağlantı YALNIZCA bileşen
// durumunda tutulur (URL, depolama, log yok); kapatılınca ya da sayfa yenilenince kaybolur (A-42).
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Banner, Button, TriangleAlert } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import { KalipPencere, KalipPencereAlan, KalipPencereDugme, KalipPencereSecim } from "../kalip/pencere.tsx";
import { inviteMemberAction } from "./actions.ts";

/** Sunucu eylem hatası (`ActionResult.error`); yalnızca kod + ayrıntı + istek kimliği kullanılır. */
export interface ServerError {
  readonly code: string;
  readonly detail?: string | undefined;
  readonly requestId?: string | undefined;
}

const LINK_CLS =
  "inline-flex min-h-12 min-w-12 items-center justify-center rounded-control px-2 text-base font-semibold text-accent-ink underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Hata: neden + sonraki eylem (`members.errors.*`); kod ve istek kimliği destek içindir. İç neden ayrıştırılmaz. */
export function ServerErrorBanner({ error, returnTo }: { error: ServerError; returnTo: string }) {
  const t = useTranslations("members.errors");
  const known = ["forbidden", "unauthenticated", "not_found", "validation_failed", "version_conflict", "rate_limited", "tenant_suspended", "tenant_closing", "internal"];
  const base = error.code.toLowerCase();
  const key = known.includes(base) ? base : "internal";
  const detailed = error.detail === undefined ? null : `${key}_${error.detail.toLowerCase()}`;
  const hasDetailed = detailed !== null && t.has(detailed);
  const prefix = hasDetailed ? detailed : key;
  return (
    <Banner kind="error">
      <p>
        {t(prefix)} {t(`${prefix}Action`)}
      </p>
      {error.detail === "MFA_REQUIRED" ? (
        <a className={LINK_CLS} href={`/mfa?next=${encodeURIComponent(returnTo)}`}>
          {t("mfaLink")}
        </a>
      ) : null}
      {error.detail === "RECENT_AUTH_REQUIRED" ? (
        <a className={LINK_CLS} href={`/login?reauth=1&next=${encodeURIComponent(returnTo)}`}>
          {t("loginLink")}
        </a>
      ) : null}
      <p className="mt-1 break-all text-sm">
        {t("code", { code: error.code })}
        {error.requestId ? ` · ${error.requestId}` : ""}
      </p>
    </Banner>
  );
}

/** Tek seferlik bağlantı: salt okunur alan + "Kopyala" + uyarı. */
export function LinkBox({ title, link, warning, onDismiss }: { title: string; link: string; warning: string; onDismiss: () => void }) {
  const t = useTranslations("members.linkBox");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      // T-1001 (ALTIN-KURAL 5): küçük işlem — sessiz; düğmede 2 sn "Kopyalandı".
      setState("copied");
      window.setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 2000);
    } catch {
      setState("failed");
    }
  }
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 rounded-card border-2 border-warning bg-surface p-4 shadow-card" data-testid="link-box">
      <div className="flex min-w-0 items-center gap-2">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0 text-warning" />
        <h3 className="min-w-0 break-words text-lg font-bold text-ink">{title}</h3>
      </div>
      <Banner kind="warning">{warning}</Banner>
      <input
        readOnly
        value={link}
        aria-label={title}
        onFocus={(e) => e.currentTarget.select()}
        className="min-h-12 w-full min-w-0 rounded-card border-2 border-border-strong bg-surface px-4 text-base text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button onClick={() => void copy()}>{t("copy")}</Button>
        <Button variant="secondary" onClick={onDismiss}>
          {t("dismiss")}
        </Button>
      </div>
      <p role="status" className="break-words text-sm text-ink-muted">
        {state === "copied" ? t("copied") : state === "failed" ? `${t("copyFailed")} ${t("copyFailedAction")}` : ""}
      </p>
    </section>
  );
}

interface InviteResult {
  readonly delivery: "EMAIL" | "SCREEN";
  readonly inviteLink?: string;
}

export function InviteDialog({
  open,
  slug,
  roleKeys,
  onClose,
  onInvited,
}: {
  open: boolean;
  slug: string;
  roleKeys: readonly string[];
  onClose: () => void;
  /** Bağlantı üst bileşene verilmez; yalnızca liste yenilenir. */
  onInvited: () => void;
}) {
  const t = useTranslations("members.inviteDialog");
  const tr = useTranslations("roles");
  const tl = useTranslations("members.linkBox");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerError | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setResult(null);
    }
  }, [open]);

  const close = (): void => {
    setResult(null); // bağlantı kapanışta bellekten düşer
    onClose();
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const res = await inviteMemberAction({ slug, email: String(form.get("email") ?? ""), roleKey: String(form.get("roleKey") ?? "") });
    setBusy(false);
    if (!res.ok) {
      setError({ code: res.error.code, detail: res.error.detail, requestId: res.error.requestId });
      return;
    }
    setResult({ delivery: res.data.delivery, ...(res.data.inviteLink === undefined ? {} : { inviteLink: res.data.inviteLink }) });
    onInvited();
  }

  // T-974 (B-63 grup B): kalıp penceresi (telefonda alt cam sayfa, masaüstünde ortada).
  return (
    <KalipPencere
      open={open}
      title={t("title")}
      titleId="invite-title"
      icon={{ d: LICON.people, color: "6C4BD8" }}
      busy={busy}
      onClose={close}
      {...(result === null ? { onSubmit: (e: FormEvent<HTMLFormElement>) => void onSubmit(e) } : {})}
      footer={
        result === null ? (
          <>
            <KalipPencereDugme kind="cancel" onClick={close} disabled={busy}>
              {t("close")}
            </KalipPencereDugme>
            <KalipPencereDugme type="submit" loading={busy}>
              {t("submit")}
            </KalipPencereDugme>
          </>
        ) : (
          <KalipPencereDugme onClick={close}>{t("close")}</KalipPencereDugme>
        )
      }
    >
      {result === null ? (
        <>
          <KalipPencereAlan label={t("email")} hint={t("emailHint")} name="email" type="email" autoComplete="off" required />
          <KalipPencereSecim label={t("role")} id="invite-role" name="roleKey" defaultValue="READ_ONLY">
            {roleKeys.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </KalipPencereSecim>
          {error ? <ServerErrorBanner error={error} returnTo={`/t/${slug}/members`} /> : null}
        </>
      ) : result.delivery === "EMAIL" || result.inviteLink === undefined ? (
        <Banner kind="info">{t("sentEmail")}</Banner>
      ) : (
        <>
          <Banner kind="warning">{t("sentScreen")}</Banner>
          <LinkBox title={t("linkLabel")} link={result.inviteLink} warning={tl("warning")} onDismiss={close} />
        </>
      )}
    </KalipPencere>
  );
}
