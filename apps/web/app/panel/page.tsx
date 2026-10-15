import { redirect } from "next/navigation";
import { panelOperatorOrExit } from "./gate.ts";

// Panel ana sayfası: Özet ekranı (Yonet.dc.html `ozet`) T-408 ile gelir; o zamana dek tek yapılmış sayfaya gider.
export const dynamic = "force-dynamic";

export default async function PanelHome() {
  await panelOperatorOrExit("/");
  redirect("/talepler");
}
