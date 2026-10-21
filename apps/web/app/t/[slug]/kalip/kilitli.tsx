"use client";
// T-1001 (ALTIN-KURAL 17): yetkisiz dokunuş. Kilitli öğe gizlenmiyorsa dokununca sarı "Değiştirme yetkin yok · sorumluna sor"
// balonu + uyarı/hata sesi. Öğe gerçek `disabled` DEĞİLDİR (dokunuş yakalansın): `aria-disabled="true"` + `data-kilitli`, işlem çağrılmaz.
// Satırlar (`KalipSatir`, `KalipAnahtar`) `locked` iken aynı işlevi kullanır.
import { useTranslations } from "next-intl";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { balonGoster, sesCal } from "@wms/ui";
import { LICON } from "../../../design/kalip-icons.ts";

let metin = "Değiştirme yetkin yok · sorumluna sor";

/** Kök katman dil dosyasındaki metni bir kez verir. */
export function kilitliMetniAyarla(m: string): void {
  if (m !== "") metin = m;
}

/** Kilitli öğeye dokunuldu: sarı balon + hata sesi. */
export function kilitliDokunus(ozel?: string): void {
  sesCal("hata");
  balonGoster({ tur: "warn", metin: ozel ?? metin, ses: false });
}

export interface KalipKilitliDugmeProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "disabled"> {
  /** Kilitli mi; değilse `onClick` çalışır. */
  readonly kilitli: boolean;
  readonly onClick?: () => void;
  /** Kilitli iken gösterilecek özel gerekçe (yoksa ortak cümle). */
  readonly gerekce?: string;
  /** Kilit ikonunu düğmenin sonuna ekle (varsayılan evet). */
  readonly kilitIkonu?: boolean;
  readonly children: ReactNode;
}

/** Ortak kilitli düğme: kilitliyken dokunuş balon + ses verir, işlem çağrılmaz. */
export function KalipKilitliDugme({ kilitli, onClick, gerekce, kilitIkonu = true, children, type = "button", ...rest }: KalipKilitliDugmeProps) {
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
          kilitliDokunus(gerekce);
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
