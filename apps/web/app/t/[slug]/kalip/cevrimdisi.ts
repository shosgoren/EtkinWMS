"use client";
// T-436 (ALTIN-KURAL 9): bağlantı durumu ve çevrimdışı engeli — tek kaynak. Uygulamada çevrimdışı kuyruk (saklayıp sonra gönderme)
// YOKTUR (taranmıştır: yalnız sunucu tarafı pg-boss kuyruğu var); bu yüzden çevrimdışıyken gönderilmek istenen işlem açıkça engellenir
// ve "Bağlantı yok · bağlanınca tekrar dene" balonu çıkar. Kök düzendeki `KuralKatmani` form gönderimlerini de aynı kuralla durdurur.
import { useEffect, useState } from "react";
import { feedback } from "@wms/ui";

/** Tarayıcı çevrimiçi mi (SSR'de ve bilinmiyorsa `true`). */
export function cevrimiciMi(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Bağlantı durumunu izler (online/offline olayları). */
export function useCevrimici(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = (): void => setOnline(cevrimiciMi());
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

let metin = "Bağlantı yok · bağlanınca tekrar dene";

/** Kök katman dil dosyasındaki metni bir kez verir (balon her ekranda aynı cümle). */
export function cevrimdisiMetniAyarla(m: string): void {
  if (m !== "") metin = m;
}

/** Çevrimdışıysa uyarı balonu + ses ve `true` döner (çağıran işlemi göndermez). */
export function cevrimdisiEngel(): boolean {
  if (cevrimiciMi()) return false;
  feedback.warn(metin);
  return true;
}
