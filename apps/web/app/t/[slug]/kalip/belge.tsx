"use client";
// T-1119 (B-123, kullanıcı 28 Ekim: "Tüm form alt formlara bak, eksik eski tasarım öğelerine ait bir şey kalmasın"): belge formlarının
// (mal kabul, sevk, üretim, stok fişi, sayım) iç parçaları — eski @wms/ui Banner / Button ve Tailwind kutuları yerine tek kalıp görünümü.
//  - `KalipBildirim`: hata / uyarı / tamam / bilgi bandı. Trafik ışığı (ALTIN-KURAL): yalnız hata (kırmızı) ve uyarı (sarı) dolu; tamam ve
//    bilgi beyaz kart + renkli simge. Rol eski Banner ile aynı: hata `alert`, diğerleri `status`. Görünüm kök belirteçlerden (`--color-kr-*`,
//    standart.css): form, ayrıntı ve saha kaplarında aynıdır.
//  - `KalipDugme`: formun iç düğmeleri (satır ekle, kontrol et, onayla, yeniden dene). `ana` lacivert, `ikincil` beyaz kart + ince çerçeve,
//    `tehlike` kırmızı çerçeve; ≥ 48 px; `busy` dönen gösterge (`.kyuk`, ALTIN-KURAL 6) + `aria-busy`.
//  - `KalipSatirKart`: tekrarlanan satırın (malzeme / sipariş ürünü) alt kartı — başlık + sağda simgeli "çıkar".
//  - `KalipFormKap`: form kabı (`.dzf`) dışındaki ekranlarda (ayrıntı: üretim emri, sevk siparişi, sayım, stok belgesi) form parçalarının
//    (`KalipGrup`, `KalipAlan`, `KalipSecim`) kaynak görünümü için `.dzf` kapsamı; kutu üretmez (`display: contents`), koyu tema kabdan.
import { useContext, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LICON } from "../../../design/kalip-icons.ts";
import { Ico } from "./ico.tsx";
import { KalipKapCtx } from "./kap.ts";

export type KalipBildirimTur = "hata" | "uyari" | "tamam" | "bilgi";
const BILDIRIM_IKON: Record<KalipBildirimTur, string> = { hata: LICON.warn, uyari: LICON.warn, tamam: LICON.check, bilgi: LICON.info };

/** Bildirim bandı: simge kutusu + kalın başlık + kısa açıklama (çocuklar). */
export function KalipBildirim({ tur, title, children, testId }: { tur: KalipBildirimTur; title?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className={`kbil ${tur}`} role={tur === "hata" ? "alert" : "status"} data-tur={tur} data-testid={testId}>
      <i aria-hidden="true">
        <Ico d={BILDIRIM_IKON[tur]} size={22} />
      </i>
      <div className="kbil-t">
        {title === undefined ? null : <b>{title}</b>}
        {children}
      </div>
    </div>
  );
}

export type KalipDugmeTur = "ana" | "ikincil" | "tehlike";

/** Form içi düğme. `className` ek sınıf içindir (ör. alt çubuğun çağırdığı `workflow-primary`). */
export function KalipDugme({ tur = "ikincil", d, busy = false, className, type = "button", children, ...rest }: { tur?: KalipDugmeTur; d?: string; busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type={type} className={`kdug ${tur}${className === undefined ? "" : ` ${className}`}`} aria-busy={busy || undefined}>
      {busy ? <span className="kyuk" aria-hidden="true" /> : d === undefined ? null : <Ico d={d} size={20} />}
      <span>{children}</span>
    </button>
  );
}

/** Tekrarlanan satır alt kartı (rol `group`, ad = başlık). */
export function KalipSatirKart({ title, remove, children, testId }: { title: string; remove?: { readonly label: string; readonly onClick: () => void; readonly disabled?: boolean }; children: ReactNode; testId?: string }) {
  return (
    <div className="ksatk" role="group" aria-label={title} data-testid={testId}>
      <div className="ksatk-h">
        <b>{title}</b>
        {remove === undefined ? null : (
          <button type="button" className="ksatk-x" aria-label={remove.label} title={remove.label} disabled={remove.disabled} onClick={remove.onClick}>
            <Ico d={LICON.trash} size={20} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/** Form kabı dışındaki ekranda form parçaları için `.dzf` kapsamı (form kabının içinde ya da kap yokken olduğu gibi geçer). */
export function KalipFormKap({ children }: { children: ReactNode }) {
  const kap = useContext(KalipKapCtx);
  if (kap === null || kap.kind === "form") return <>{children}</>;
  return <div className={`dzf kbelge${kap.dark ? " dz-dark" : ""}`}>{children}</div>;
}
