"use client";
// T-1122 (B-63, ALTIN-KURAL 3/7): sayfa yüklenirken gelen sonuç bildirimi (ör. Görevlerim "?claimed=1" / "?error=…"). Eski `Banner`ın yerine:
// başarı sakin beyaz kart + yeşil onay simgesi (trafik ışığı: renk simgede), hata kırmızı dolu kart + uyarı simgesi; ikisi de sesli (ortak
// `useSonucSesi`) ve ekran okuyucuya duyurulur. Sunucu bileşeninden kullanılabilir (yalnız metin alır). Görünüm `design/standart.css` `.kbld`.
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico } from "./ekran.tsx";
import { useSonucSesi } from "./sonuc-sesi.ts";

export function KalipBildirim({ tur, title, sub, testId }: { tur: "ok" | "err"; title: string; sub?: string; testId?: string }) {
  useSonucSesi(tur === "err" ? { hata: title } : { tamam: title });
  return (
    <div className={`kbld ${tur}`} role={tur === "err" ? "alert" : "status"} data-testid={testId ?? "kalip-bildirim"} data-tur={tur}>
      <i aria-hidden="true">
        <Ico d={tur === "err" ? LICON.warn : LICON.check} size={22} />
      </i>
      <span style={{ minWidth: 0 }}>
        <b>{title}</b>
        {sub === undefined || sub === "" ? null : <small>{sub}</small>}
      </span>
    </div>
  );
}
