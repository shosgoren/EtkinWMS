"use client";
// T-1037 (kullanıcı isteği 25 Ekim "fazlalıkları kaldır, hepsi bir standart"): Stok işlemleri listesinin üstündeki iki kesik çizgili düğme
// (Stok çıkışı, Depolar arası transfer) yerine tek ana işlem YENİ → büyük ikonlu seçim (Giriş · Çıkış · Transfer). Ortak `KalipSecimKutulari`;
// yetkisi olmayan seçenek kilitli (dokununca ses + gerekçe balonu).
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { feedback } from "@wms/ui";
import { KalipSecimKutulari, type KalipSecimItem } from "../../kalip/secim.tsx";

export function YeniIslemSecim({ items }: { items: readonly (KalipSecimItem & { readonly href: string })[] }) {
  const t = useTranslations("stockDocuments");
  const router = useRouter();
  return (
    <KalipSecimKutulari
      items={items}
      value={null}
      label={t("k.pickLabel")}
      testId="documents-new-pick"
      onPick={(id) => {
        const it = items.find((x) => x.id === id);
        if (it !== undefined) router.push(it.href);
      }}
      onLocked={() => feedback.warn(t("k.lockedHint"))}
    />
  );
}
