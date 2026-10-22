// T-436 (ALTIN-KURAL 7): kiracı alanında bulunamayan sayfa / kayıt (`notFound()`) — ortak hata ekranı, tasarım dilinde.
// Varlık sızdırılmaz: "adres değişmiş ya da erişimin yok" tek cümlesi her durumda aynıdır.
import { cookies } from "next/headers";
import { temaKoyu } from "../../design/theme.ts";
import { HataEkrani } from "./kalip/hata-ekrani.tsx";

export default async function TenantNotFound() {
  const dark = temaKoyu(await cookies());
  return <HataEkrani tur="bulunamadi" home="/" dark={dark} />;
}
