import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { temaKoyu } from "../../../design/theme.ts";
import { SahaTheme } from "./saha-shell.tsx";

// The tenant BottomNav owns field navigation. Space for its fixed 74px bar remains in the scroll area.
// T-1122: eski Tailwind kabı kaldırıldı (saha ekranları `.dzs` tam ekran kabıdır; `field-screen` yalnız alt boşluk).
// T-969: Saha kalıbı ekranları (OKUT, kabul, yerleştirme) tasarım temasını (açık/koyu, `dz-theme` çerezi) buradan alır.
export default async function FieldLayout({ children }: { children: ReactNode }) {
  const dark = temaKoyu(await cookies());
  return (
    <div className="field-screen" data-testid="field-shell">
      <SahaTheme dark={dark}>{children}</SahaTheme>
    </div>
  );
}
