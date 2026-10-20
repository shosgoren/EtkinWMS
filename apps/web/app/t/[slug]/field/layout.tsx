import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { THEME_COOKIE } from "../../../design/theme.ts";
import { SahaTheme } from "./saha-shell.tsx";

// The tenant BottomNav owns field navigation. Space for its fixed 74px bar remains in the scroll area.
// T-969: Saha kalıbı ekranları (OKUT, kabul, yerleştirme) tasarım temasını (açık/koyu, `dz-theme` çerezi) buradan alır.
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const dark = (await cookies()).get(THEME_COOKIE)?.value === "koyu";
  return (
    <div className="field-screen mx-auto flex w-full max-w-md min-w-0 flex-col pb-24" data-testid="field-shell">
      <SahaTheme dark={dark}>{children}</SahaTheme>
    </div>
  );
}
