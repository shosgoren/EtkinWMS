"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ArrowLeftRight, Boxes, FileText, House, Package, ScanLine, Settings2, Truck, Undo2, Users, Warehouse } from "@wms/ui";

// Always return a tenant-local parent, including when a form/detail was opened by a direct URL.
export function screenParent(base: string, pathname: string, detail: boolean): string {
  if (!pathname.startsWith(`${base}/`)) return base;
  if (detail) return pathname;
  const parent = pathname.slice(0, pathname.lastIndexOf("/"));
  return parent.length >= base.length ? parent : base;
}

const sections = {
  production: { icon: Boxes, tone: "purple" }, shipping: { icon: Truck, tone: "green" },
  stock: { icon: ArrowLeftRight, tone: "sky" }, field: { icon: ScanLine, tone: "orange" },
  items: { icon: Package, tone: "orange" }, warehouses: { icon: Warehouse, tone: "teal" },
  members: { icon: Users, tone: "indigo" }, settings: { icon: Settings2, tone: "slate" },
} as const;
const linkClass = "flex min-h-12 min-w-12 items-center gap-2 rounded-control border-2 border-border-strong bg-surface px-4 font-bold text-ink";

export function ScreenShell({ slug, children }: { slug: string; children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const t = useTranslations("shell.screen");
  const base = `/t/${encodeURIComponent(slug)}`;
  if (pathname === base) return children;
  const name = pathname.slice(base.length + 1).split("/")[0] ?? "";
  const section = sections[name as keyof typeof sections];
  const Icon = section?.icon ?? FileText;
  const isField = name === "field";
  const detail = search.has("id") || search.has("new");
  const parent = screenParent(base, pathname, detail);
  return (
    <div className={`screen-shell ${isField ? "screen-field" : "screen-interior"}`} data-testid="screen-shell" data-section={name === "field" && pathname.endsWith("/receive") ? "receive" : name === "stock" && search.get("new") === "TRANSFER" ? "transfer" : name} data-mode={detail ? "detail" : "list"} data-tone={section?.tone ?? "slate"}>
      {!isField && <aside className="screen-context" aria-label={t("context")}>
        <div className="screen-category">
          <span className="screen-icon" aria-hidden="true"><Icon className="size-6" /></span>
          <p className="font-extrabold">{t(section ? name : "other")}</p>
        </div>
        <nav className="screen-desktop-nav" aria-label={t("navigation")}>
          <Link data-testid="screen-back" href={parent} className={linkClass}><Undo2 className="size-5" aria-hidden="true" />{t("back")}</Link>
          <Link data-testid="screen-home" href={base} className={linkClass}><House className="size-5" aria-hidden="true" />{t("home")}</Link>
        </nav>
      </aside>}
      <div className="screen-content">{children}</div>
    </div>
  );
}

// These numbers describe editable groups, never claim an unfinished operation is complete.
export function FormSteps({ labels }: { labels: readonly string[] }) {
  const t = useTranslations("shell.screen");
  return <ol className="workflow-steps" aria-label={t("steps")}>{labels.map((label, index) => <li key={label}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>;
}
