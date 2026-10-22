// T-436 (ALTIN-KURAL 7): eşleşmeyen her adres (müşteri uygulaması ve yönetim paneli) — ortak "bulunamadı" ekranı, tasarım dilinde.
import { cookies } from "next/headers";
import { temaKoyu } from "./design/theme.ts";
import { HataEkrani } from "./t/[slug]/kalip/hata-ekrani.tsx";

export default async function NotFound() {
  const dark = temaKoyu(await cookies());
  return <HataEkrani tur="bulunamadi" home="/" dark={dark} />;
}
