"use client";
// Uygulama menüsü ("Tüm ekranlar"; T-254, T-979; T-979b B-100 kalıp penceresinde). Pano/kalıp ekranlarındaki Hesap menüsünün "Tüm ekranlar"
// öğesinden ve Görevlerim ⚠ kutusundan açılır: Akış/Genel bakış, çalışma alanı değiştirme, "Giriş yapan", yetkili yönetim sayfaları, Yardım,
// Çıkış. Görünüm ortak kalıp penceresidir (`KalipPencere`: buzlu perde + cam kutu, telefonda alt sayfa, koyu tema, Esc ile kapanır, odak
// tarayıcı tuzağında); kapanınca odak menüyü açan öğeye döner (yoksa sayfanın Hesap düğmesine). Yetki/üyelik kararı sunucuda (layout.tsx).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { SignOutButton } from "../../auth-forms.tsx";
import { LICON } from "../../design/kalip-icons.ts";
import { Ico } from "./kalip/ekran.tsx";
import { KalipPencere, KalipPencereDugme } from "./kalip/pencere.tsx";
import { kdz } from "./kalip/tokens.ts";

export const APP_MENU_ID = "app-menu";
const OPEN_EVENT = "wms:app-menu-open";

/** Menü penceresini açar (Hesap menüsü "Tüm ekranlar", Görevlerim ⚠ kutusu). Odak, kapanınca şimdiki odaklı öğeye döner. */
export function openAppMenu(): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: document.activeElement }));
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
  /** Yönetim sayfaları (yetkiye göre süzülmüş). */
  readonly links?: readonly { readonly href: string; readonly label: string }[];
  readonly linksLabel?: string;
}

const c = (hex: string): string => kdz("dzf", hex);
const ROW: CSSProperties = { textDecoration: "none", color: "inherit", flexDirection: "row", alignItems: "center", gap: 10 };

export function AppMenu({ slug, userName, memberships, view, setViewAction, links = [], linksLabel }: AppMenuProps) {
  const t = useTranslations("shell");
  const tb = useTranslations("tenantBar");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const from = (e as CustomEvent<Element | null>).detail;
      opener.current = from instanceof HTMLElement && from !== document.body ? from : null;
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // Pencere DOM'dan kalkınca odak açan öğeye döner; o öğe artık yoksa (Hesap menüsü kapandı) sayfanın Hesap düğmesine.
    window.requestAnimationFrame(() => {
      const back = opener.current;
      const target = back !== null && back.isConnected ? back : document.querySelector<HTMLElement>('#main [data-testid="home-actions"]');
      if (target instanceof HTMLElement) target.focus();
    });
  }, []);

  // Sayfa değişince menü kapanır (düzen sayfalar arasında bellekte kalır).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <KalipPencere
      open={open}
      title={t("menu.title")}
      icon={{ d: LICON.grid, color: "172E42" }}
      onClose={close}
      testId={APP_MENU_ID}
      footer={
        <KalipPencereDugme kind="cancel" onClick={close}>
          {t("menu.close")}
        </KalipPencereDugme>
      }
    >
      <p className="kmu">
        {tb("user", { name: userName })}
      </p>

      <form action={setViewAction} aria-label={t("viewSwitch.label")} style={{ margin: 0 }}>
        <div role="group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {(["flow", "cockpit"] as const).map((v) => (
            <button
              key={v}
              type="submit"
              name="view"
              value={v}
              aria-pressed={view === v}
              className={`gp${view === v ? " on" : ""}`}
              style={{ justifyContent: "center", ...(view === v ? { background: c("172E42") } : {}) }}
            >
              <Ico d={v === "flow" ? LICON.clip : LICON.grid} size={18} />
              {t(`viewSwitch.${v}`)}
            </button>
          ))}
        </div>
      </form>

      <section aria-label={tb("label")} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="kmh">{tb("label")}</span>
        <ul className="kplist kmlist" style={{ maxHeight: "none" }}>
          {memberships.map((m) => (
            <li key={m.slug} style={{ listStyle: "none" }}>
              <Link href={`/t/${encodeURIComponent(m.slug)}`} prefetch={false} aria-current={m.slug === slug ? "page" : undefined} className="kpopt" style={ROW}>
                <Ico d={LICON.workspace} size={20} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span className="kpo1">{m.tenantName}</span>
                  <span className="kpo2">
                    {m.rolesLabel}
                    {m.slug === slug ? ` · ${tb("current")}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {links.length > 0 ? (
        <nav aria-label={linksLabel} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="kmh">{linksLabel}</span>
          <ul className="kplist kmlist" style={{ maxHeight: "none" }}>
            {links.map((l) => (
              <li key={l.href} style={{ listStyle: "none" }}>
                <Link href={l.href} className="kpopt" style={ROW}>
                  <span className="kpo1" style={{ flex: 1 }}>
                    {l.label}
                  </span>
                  <Ico d={LICON.chev} size={18} />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <Link href="/help" className="kpopt" style={{ ...ROW, borderRadius: 14 }}>
        <Ico d={LICON.info} size={20} />
        <span className="kpo1">{t("help.full")}</span>
      </Link>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SignOutButton />
      </div>
    </KalipPencere>
  );
}
