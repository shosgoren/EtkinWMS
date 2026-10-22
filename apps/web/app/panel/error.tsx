"use client";
// T-436 (ALTIN-KURAL 7): yönetim paneli hata sınırı — müşteri alanıyla aynı ortak hata ekranı (ikon, tek cümle, Tekrar dene, destek
// kodu, hata sesi). Ham hata metni gösterilmez.
import { HataEkrani } from "../t/[slug]/kalip/hata-ekrani.tsx";

export default function PanelError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <HataEkrani tur="hata" kod={error.digest} onRetry={retry} home="/" />;
}
