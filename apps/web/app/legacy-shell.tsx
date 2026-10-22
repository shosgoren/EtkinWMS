"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Çalışma alanı kendi kabuğunu çizer; yükleme/hata sırasında da eski kabuk ilk render'da yoktur. */
export function LegacyShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/t" || pathname.startsWith("/t/")) return null;
  return <>{children}</>;
}
