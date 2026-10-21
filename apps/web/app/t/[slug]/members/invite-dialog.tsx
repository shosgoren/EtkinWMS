"use client";
// Davet formu (T-990: tam ekran) + tek seferlik bağlantı kutusu + sunucu hatası gösterimi (T-119). Düz bağlantı YALNIZCA bileşen
// durumunda tutulur (URL, depolama, log yok); kapatılınca ya da sayfa yenilenince kaybolur (A-42).
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Banner, Button, TriangleAlert } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import type { AlanKurali } from "../kalip/dogrula.ts";
import { KalipEkran } from "../kalip/ekran.tsx";
import { KalipFormEkran, KalipOnizleme, type KaydetSonuc } from "../kalip/form-ekran.tsx";
import { KalipAlan, KalipGrup } from "../kalip/form.tsx";
import { KalipSecim } from "../kalip/secim.tsx";
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
      setState("copied");
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

/** Rol kutularının ikonu ve rengi (yalnız görsel; yetki sunucuda). */
export const ROLE_VISUAL: Readonly<Record<string, { readonly d: string; readonly color: string }>> = {
  TENANT_ADMIN: { d: LICON.shield, color: "172E42" },
  WAREHOUSE_MANAGER: { d: LICON.depo, color: "2F5DA8" },
  PICKER: { d: LICON.moveOut, color: "B85A14" },
  COUNTER: { d: LICON.clip, color: "6C4BD8" },
  READ_ONLY: { d: LICON.info, color: "4E6476" },
};
const ROLE_DEFAULT = { d: LICON.people, color: "2F5DA8" };

interface InviteValues extends Readonly<Record<string, unknown>> {
  readonly email: string;
  readonly roleKey: string;
}

/**
 * T-990 (B-97): üye daveti TAM EKRAN FORMDUR (pencere değil; adres `?invite=1`, ekran yönetir). Alanlar: e-posta (`kind: "email"` kuralı) +
 * rol kutuları (≤6 seçenek, `KalipSecim`). Doğrulama, GÖNDER (yalnız değişiklikte etkin), çıkış uyarısı `KalipFormEkran` içindedir.
 * Sunucu reddi neden ayrıştırılmadan formun altında (`ServerErrorBanner`). Başarıda aynı adreste sonuç ekranı: e-postayla gitti bilgisi ya
 * da tek seferlik bağlantı kutusu (bağlantı yalnız bu bileşenin belleğinde; TAMAM/Geri ile düşer).
 */
export function InviteForm({
  slug,
  dark,
  roleKeys,
  onClose,
  onInvited,
}: {
  slug: string;
  dark: boolean;
  roleKeys: readonly string[];
  onClose: () => void;
  /** Bağlantı üst bileşene verilmez; yalnızca liste yenilenir. */
  onInvited: () => void;
}) {
  const t = useTranslations("members.inviteDialog");
  const tr = useTranslations("roles");
  const tl = useTranslations("members.linkBox");
  const home = `/t/${encodeURIComponent(slug)}`;
  const [initial] = useState<InviteValues>(() => ({ email: "", roleKey: roleKeys.includes("READ_ONLY") ? "READ_ONLY" : (roleKeys[0] ?? "") }));
  const [f, setF] = useState<InviteValues>(initial);
  const [error, setError] = useState<ServerError | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const sonuc = useRef<InviteResult | null>(null);
  const rules: AlanKurali[] = [
    { name: "email", label: t("email"), required: true, kind: "email", maxLength: 320 },
    { name: "roleKey", label: t("role"), required: true },
  ];
  const v = ROLE_VISUAL[f.roleKey] ?? ROLE_DEFAULT;

  async function save(): Promise<KaydetSonuc> {
    setError(null);
    const res = await inviteMemberAction({ slug, email: f.email.trim(), roleKey: f.roleKey });
    if (!res.ok) {
      setError({ code: res.error.code, detail: res.error.detail, requestId: res.error.requestId });
      return { ok: false, mesaj: t("failed") };
    }
    sonuc.current = { delivery: res.data.delivery, ...(res.data.inviteLink === undefined ? {} : { inviteLink: res.data.inviteLink }) };
    // Tek seferlik bağlantı ekranda gösterilecekse "Gönder ve çık" seçilse bile ekranda kalınır (bağlantı kaybolmasın).
    return res.data.inviteLink === undefined ? { ok: true } : { ok: true, kal: true };
  }

  const close = (): void => {
    setResult(null); // bağlantı kapanışta bellekten düşer
    sonuc.current = null;
    onClose();
  };

  if (result !== null) {
    return (
      <KalipEkran
        kind="form"
        dark={dark}
        title={t("title")}
        subtitle={t("resultSub")}
        icon={{ d: LICON.people, color: "6C4BD8" }}
        testId="invite-result"
        bar={{
          back: { onClick: close, aria: t("close") },
          homeNav: { href: home },
          main: { label: t("doneShort"), aria: t("close"), d: LICON.check, onClick: close, testId: "invite-done" },
        }}
      >
        <div className="kfl">
          <div className="kfc">
            {result.delivery === "EMAIL" || result.inviteLink === undefined ? (
              <Banner kind="info">{t("sentEmail")}</Banner>
            ) : (
              <>
                <Banner kind="warning">{t("sentScreen")}</Banner>
                <LinkBox title={t("linkLabel")} link={result.inviteLink} warning={tl("warning")} onDismiss={close} />
              </>
            )}
          </div>
        </div>
      </KalipEkran>
    );
  }

  return (
    <KalipFormEkran
      dark={dark}
      title={t("title")}
      subtitle={t("sub")}
      icon={{ d: LICON.people, color: "6C4BD8" }}
      testId="invite-form"
      values={f}
      initial={initial}
      rules={rules}
      onSave={save}
      onDone={() => {
        setResult(sonuc.current ?? { delivery: "EMAIL" });
        onInvited();
      }}
      onBack={close}
      homeHref={home}
      saveShort={t("sendShort")}
      saveAria={t("submit")}
      savedText={t("sent")}
      leaveText={t("leaveText")}
      leaveSaveLabel={t("leaveSave")}
      preview={<KalipOnizleme name={f.email} code={tr(f.roleKey)} d={v.d} color={v.color} kind={t("role")} />}
    >
      <KalipGrup title={t("gWho")} d={LICON.people} color="6C4BD8">
        <KalipAlan
          label={`${t("email")} *`}
          hint={t("emailHint")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          maxLength={320}
          value={f.email}
          onChange={(e) => setF((cur) => ({ ...cur, email: e.target.value }))}
        />
      </KalipGrup>
      <KalipGrup title={t("gRole")} d={LICON.shield} color={v.color}>
        <KalipSecim
          name="roleKey"
          label={t("role")}
          value={f.roleKey}
          color={v.color}
          onPick={(id) => setF((cur) => ({ ...cur, roleKey: id }))}
          options={roleKeys.map((r) => ({ id: r, label: tr(r), d: (ROLE_VISUAL[r] ?? ROLE_DEFAULT).d, color: (ROLE_VISUAL[r] ?? ROLE_DEFAULT).color }))}
          testId="invite-role"
        />
      </KalipGrup>
      {error ? <ServerErrorBanner error={error} returnTo={`/t/${slug}/members`} /> : null}
    </KalipFormEkran>
  );
}
