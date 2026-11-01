"use client";
// T-436 (ALTIN-KURAL 17): yetkisiz dokunuş. Kilitli öğe gizlenmiyorsa dokununca sarı "Değiştirme yetkin yok · sorumluna sor"
// balonu + uyarı/hata sesi. Öğe gerçek `disabled` DEĞİLDİR (dokunuş yakalansın): `aria-disabled="true"` + `data-kilitli`, işlem çağrılmaz.
// Satırlar (`KalipSatir`, `KalipAnahtar`) `locked` iken aynı işlevi kullanır.
import { useTranslations } from "next-intl";
import { useCallback, type ButtonHTMLAttributes, type ReactNode } from "react";
import { balonGoster, sesCal, type BalonEylem } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";
import type { KartBolum as CardSection } from "./kart-yetki.ts";

let metin = "Değiştirme yetkin yok · sorumluna sor";

/** Kök katman dil dosyasındaki metni bir kez verir. */
export function kilitliMetniAyarla(m: string): void {
  if (m !== "") metin = m;
}

/**
 * Kilitli öğeye dokunuldu: sarı balon + hata sesi. T-1201: `eylem` verilirse balonda tek düğme (ör. "Şimdi eşitle"); eylemli balon
 * okunacak kadar uzun kalır.
 */
export function kilitliDokunus(ozel?: string, eylem?: BalonEylem): void {
  sesCal("hata");
  balonGoster({ tur: "warn", metin: ozel ?? metin, ses: false, ...(eylem === undefined ? {} : { eylem, sure: 6000 }) });
}

export interface KalipKilitliDugmeProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled"> {
  /** Kilitli mi; değilse `onClick` çalışır. */
  readonly kilitli: boolean;
  readonly onClick?: () => void;
  /** Kilitli iken gösterilecek özel gerekçe (yoksa ortak cümle). */
  readonly gerekce?: string;
  /** Kilit ikonunu düğmenin sonuna ekle (varsayılan evet). */
  readonly kilitIkonu?: boolean;
  /** T-1201: kilitli balondaki tek eylem (ör. "Şimdi eşitle"). */
  readonly eylem?: BalonEylem | undefined;
  readonly children: ReactNode;
}

/** Ortak kilitli düğme: kilitliyken dokunuş balon + ses verir, işlem çağrılmaz. */
export function KalipKilitliDugme({ kilitli, onClick, gerekce, kilitIkonu = true, eylem, children, type = "button", ...rest }: KalipKilitliDugmeProps) {
  const t = useTranslations("kural");
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={kilitli ? "true" : undefined}
      data-kilitli={kilitli ? "true" : undefined}
      aria-description={kilitli ? (gerekce ?? t("locked")) : undefined}
      onClick={(e) => {
        if (kilitli) {
          e.preventDefault();
          kilitliDokunus(gerekce, eylem);
          return;
        }
        onClick?.();
      }}
    >
      {children}
      {kilitli && kilitIkonu ? (
        <svg className="ico" width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
          <path d={LICON.lock} />
        </svg>
      ) : null}
    </button>
  );
}

/**
 * T-1141: kart bölümü yetki kilidinin gerekçesi — "Ürün ekleme yetkin yok · Yetki iste: yöneticine sor". Bölüm/işlem adları
 * `@wms/domain/identity/permissions` `CARD_PERMISSION_CATALOGUE` ile aynı; metinler `yetkiKatalog.locked.<bölüm>.<işlem>`.
 */
export function useKartKilitGerekce(group: CardSection): (action: "create" | "edit" | "archive") => string {
  const t = useTranslations("yetkiKatalog.locked");
  // Kararlı başvuru: sütun/useMemo bağımlılığı her çizimde değişip döngü kurmasın.
  return useCallback((action: "create" | "edit" | "archive") => t(`${group}.${action}`), [t, group]);
}
