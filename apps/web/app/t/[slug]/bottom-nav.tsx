"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { House, ListChecks, Menu, ScanLine, Undo2 } from "@wms/ui";
import { screenParent } from "./screen-shell.tsx";
import { openAppMenu } from "./app-bar.tsx";

// Home retains its phone tabs; interior phone/tablet screens share one lower navigation layer.
// Field navigation retains its 74px geometry so its fixed primary action stays above it.
// "Görevlerim" (T-304) personelin görev listesine gider (/field/tasks); yetki ve kapsam hedef sayfada sunucuda denetlenir.

const ICON = { className: "size-6", strokeWidth: 2, "aria-hidden": true } as const;
const FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-focus";
const TAB = "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-bold";

export function BottomNav({ slug }: { slug: string }) {
  const t = useTranslations("shell.nav");
  const pathname = usePathname();
  const search = useSearchParams();
  const screen = useTranslations("shell.screen");
  const field = useTranslations("field");
  const base = `/t/${encodeURIComponent(slug)}`;
  const isField = pathname === `${base}/field` || pathname.startsWith(`${base}/field/`);
  if (pathname !== base) {
    const parent = screenParent(base, pathname, search.has("id") || search.has("new"));
    return <nav aria-label={isField ? field("actionBarLabel") : screen("navigation")} data-testid={isField ? "field-action-bar" : "screen-nav"} className={`screen-bottom-nav ${isField ? "screen-field-nav" : ""}`}>
      <Link data-testid="screen-back" href={parent} className={`screen-nav-link ${FOCUS}`}><Undo2 {...ICON}/><span>{screen("back")}</span></Link>
      <Link data-testid="screen-home" href={base} className={`screen-nav-link ${FOCUS}`}><House {...ICON}/><span>{screen("home")}</span></Link>
    </nav>;
  }

  const link = (href: string, label: string, icon: ReactNode, current: boolean) => (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`${TAB} ${FOCUS} ${current ? "bg-accent-soft text-accent-ink" : "text-ink"}`}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );

  return (
    <nav
      aria-label={t("label")}
      data-testid="bottom-nav"
      className="phone-only z-30 shrink-0 items-stretch border-t-2 border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {link(base, t("home"), <House {...ICON} />, pathname === base)}
      {link(`${base}/field`, t("scan"), <ScanLine {...ICON} />, false)}
      {link(`${base}/field/tasks`, t("tasks"), <ListChecks {...ICON} />, pathname.startsWith(`${base}/field/tasks`))}
      <button type="button" aria-haspopup="dialog" onClick={openAppMenu} className={`${TAB} ${FOCUS} cursor-pointer text-ink`}>
        <Menu {...ICON} />
        <span className="max-w-full truncate">{t("menu")}</span>
      </button>
    </nav>
  );
}
