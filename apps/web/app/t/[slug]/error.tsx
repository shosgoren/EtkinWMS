"use client";
// Tenant alanı hata sınırı (T-119 MINOR-1; T-436 ALTIN-KURAL 7). Sunucu bileşeni hataları istemciye yalnızca genel mesaj + `digest`
// olarak gelir (üretimde ham mesaj/yığın maskelenir); hata KODU buraya taşınmaz. Askıda/kapanan tenant `layout.tsx`'te kodla yakalanır;
// burası beklenmeyen hatalar içindir: ham mesaj/yığın gösterilmez — ortak hata ekranı (ikon, tek cümle, Tekrar dene, destek kodu, hata sesi).
import { useParams } from "next/navigation";
import { HataEkrani } from "./kalip/hata-ekrani.tsx";

export default function TenantError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  return <HataEkrani tur="hata" kod={error.digest} onRetry={retry} home={slug === "" ? "/" : `/t/${encodeURIComponent(slug)}`} />;
}
