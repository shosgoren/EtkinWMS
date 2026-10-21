"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";
import { SignOutButton } from "../../auth-forms.tsx";

// Uygulama menüsü sayfası (T-254; T-979'da eski telefon üst çubuğu, masaüstü `tenant-bar`, `ScreenShell` ve `BottomNav` kaldırıldı).
// Menü Pano/kalıp ekranlarındaki Hesap menüsünün "Tüm ekranlar" öğesinden ve Görevlerim ⚠ kutusundan açılır: Akış/Genel bakış,
// çalışma alanı değiştirme, "Giriş yapan", yetkili yönetim sayfaları, Yardım ve Çıkış. Yetki/üyelik kararı sunucuda (layout.tsx).

export const APP_MENU_ID = "app-menu";

/** Menü sayfasını açar (alt sekme çubuğundaki "Menü" sekmesi de bunu kullanır). */
export function openAppMenu(): void {
  const el = document.getElementById(APP_MENU_ID);
  if (el instanceof HTMLDialogElement && !el.open) el.showModal();
}

export interface AppMenuMembership {
  readonly slug: string;
  readonly tenantName: string;
  readonly rolesLabel: string;
}

export interface AppMenuProps {
  readonly slug: string;
  readonly userName: string;
  readonly memberships: readonly AppMenuMembership[];
  readonly view: "flow" | "cockpit";
  /** Kök düzendeki `setView` ile aynı çerez sözleşmesi (`view`); sunucu eylemi olarak geçirilir. */
  readonly setViewAction: (formData: FormData) => Promise<void>;
  /** Yönetim sayfaları (yetkiye göre süzülmüş); Akış ana ekranında başka bağlantı yoktur. */
  readonly links?: readonly { readonly href: string; readonly label: string }[];
  readonly linksLabel?: string;
}

const TOUCH = "min-h-12 min-w-12";
const FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function AppMenu({ slug, userName, memberships, view, setViewAction, links = [], linksLabel }: AppMenuProps) {
  const t = useTranslations("shell");
  const tb = useTranslations("tenantBar");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pathname = usePathname();

  // Sayfa değişince menü kapanır (düzen sayfalar arasında bellekte kalır).
  useEffect(() => {
    const el = ref.current;
    if (el?.open) el.close();
  }, [pathname]);

  return (
    <>
      <dialog
        ref={ref}
        id={APP_MENU_ID}
        aria-labelledby={titleId}
        data-testid="app-menu"
        onClick={(e) => {
          // Yalnızca arka plana (dialog öğesinin kendisine) tıklama kapatır.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-sm overflow-y-auto overscroll-contain bg-surface p-0 text-ink shadow-card backdrop:bg-ink/40"
      >
        <div className="flex min-h-full flex-col gap-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-2">
            <h2 id={titleId} className="text-xl font-extrabold">
              {t("menu.title")}
            </h2>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className={`${TOUCH} cursor-pointer rounded-control border-2 border-border-strong px-4 text-base font-bold ${FOCUS}`}
            >
              {t("menu.close")}
            </button>
          </div>

          <p className="break-words text-sm font-semibold text-ink-muted">{tb("user", { name: userName })}</p>

          <section aria-labelledby={`${titleId}-ws`} className="flex flex-col gap-1">
            <h3 id={`${titleId}-ws`} className="text-sm font-bold text-ink-muted">
              {tb("label")}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {memberships.map((m) => (
                <li key={m.slug}>
                  <Link
                    href={`/t/${encodeURIComponent(m.slug)}`}
                    prefetch={false}
                    aria-current={m.slug === slug ? "page" : undefined}
                    className={`${TOUCH} flex flex-col justify-center rounded-card px-3 py-1 text-base font-semibold text-ink aria-[current=page]:bg-accent-soft ${FOCUS}`}
                  >
                    <span className="break-words">{m.tenantName}</span>
                    <span className="text-sm font-normal text-ink-muted">
                      {m.rolesLabel}
                      {m.slug === slug ? ` · ${tb("current")}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {links.length > 0 ? (
            <nav aria-label={linksLabel} className="flex flex-col gap-1">
              <h3 className="text-sm font-bold text-ink-muted">{linksLabel}</h3>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={`${TOUCH} inline-flex items-center rounded-full bg-accent-soft px-4 text-base font-bold text-accent-ink ${FOCUS}`}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <form action={setViewAction} aria-label={t("viewSwitch.label")}>
            <div className="flex rounded-full bg-accent-soft p-1" role="group">
              {(["flow", "cockpit"] as const).map((v) => (
                <button
                  key={v}
                  type="submit"
                  name="view"
                  value={v}
                  aria-pressed={view === v}
                  className={`${TOUCH} flex-1 cursor-pointer rounded-full px-4 text-base font-bold ${FOCUS} ${view === v ? "bg-ink text-surface" : "text-ink"}`}
                >
                  {t(`viewSwitch.${v}`)}
                </button>
              ))}
            </div>
          </form>

          <Link
            href="/help"
            className={`${TOUCH} inline-flex items-center justify-center rounded-full bg-accent-soft px-4 text-base font-bold text-accent-ink ${FOCUS}`}
          >
            {t("help.full")}
          </Link>

          <div className="mt-auto flex flex-col items-stretch gap-2">
            <SignOutButton />
          </div>
        </div>
      </dialog>
    </>
  );
}
