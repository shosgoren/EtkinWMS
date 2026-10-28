"use client";
// T-1121 (kullanıcı 28 Ekim: "eski tasarım öğesi kalmasın"): ekran içi kalıcı uyarı bandı — eski `@wms/ui` Banner'ın yerine her kalıp
// kabında (liste / form / detay / pencere / seçim sayfası) aynı görünür. Kaynak `.lockb` / `.warnb` bandının dili: solda renkli ikon kutusu,
// sağda kalın başlık + kısa metin; renk tonu trafik ışığı (hata kırmızı, uyarı sarı, bilgi mavi). Görünüm `design/standart.css` `.kuy`
// (belirteçler `--color-kr-*`, açık + koyu tema). Hata `role="alert"`, diğerleri `role="status"` (ekran okuyucu duyurur). Geçici sonuç
// için balon (`useKalipToast`) kullanılır; bu bant yalnız ekranda kalması gereken durum içindir (sunucu reddi + destek kodu, kilit nedeni…).
// Bant içindeki bağlantı/düğme kalıp düğmesi görünümünü alır (en az 44 px). Not: detay kalıbının `.warnb` bandı ayrı ve aynı adlıdır
// (`detay.tsx` KalipUyari, yalnız `.dzd`); bu bileşen kalıptan bağımsızdır. Sunucu sayfaları da çizdiği için ağır kalıp kabını (ekran.tsx)
// içe aktarmaz; ikon kendi `.ico` SVG'sidir.
import type { ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";

export type KalipUyariTon = "hata" | "uyari" | "bilgi";

export function KalipUyari({ tone = "hata", title, children, testId }: { tone?: KalipUyariTon; title?: string; children?: ReactNode; testId?: string }) {
  return (
    <div className={`kuy ${tone}`} role={tone === "hata" ? "alert" : "status"} data-testid={testId} data-ton={tone}>
      <i>
        <svg className="ico" width={22} height={22} viewBox="0 0 24 24" aria-hidden="true">
          <path d={tone === "bilgi" ? LICON.info : LICON.warn} />
        </svg>
      </i>
      <div>
        {title === undefined ? null : <b>{title}</b>}
        {children}
      </div>
    </div>
  );
}
