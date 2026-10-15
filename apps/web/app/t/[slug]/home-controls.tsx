"use client";
// T-988: Görevlerim ana ekranı üst sağ düğmeleri (tasarım `.hic`). Bağlantı durumu tarayıcının gerçek çevrimiçi bilgisidir (uydurma yok);
// menü düğmesi uygulama menüsünü açar (Akış ana ekranında ayrı üst çubuk yoktur, `app-bar-menu` sözleşmesi burada sürer).
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Menu } from "@wms/ui";
import { GuideTrigger } from "../../first-use-guide.tsx";
import { openAppMenu } from "./app-bar.tsx";

export function HomeControls() {
  const t = useTranslations("home.gv");
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = (): void => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return (
    <div className="gv-hic">
      <span role="status" className={`gv-icb gv-net ${online ? "" : "gv-off"}`} aria-label={online ? t("online") : t("offline")} title={online ? t("online") : t("offline")} data-online={online ? "true" : "false"}>
        <span className="gv-netdot" aria-hidden="true" />
      </span>
      <GuideTrigger className="gv-icb gv-guide" iconOnly />
      <button type="button" className="gv-icb gv-menu" data-testid="app-bar-menu" aria-haspopup="dialog" aria-label={t("menu")} onClick={openAppMenu}>
        <Menu className="size-6" strokeWidth={2.4} aria-hidden="true" />
      </button>
    </div>
  );
}
