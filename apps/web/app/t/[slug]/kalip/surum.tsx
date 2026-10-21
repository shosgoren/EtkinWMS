"use client";
// T-990 (B-97) — "Kod önerisi alınamadı" HATASININ KÖK NEDENİ: Next her derlemede Server Action kimliklerini yeni, rastgele bir anahtarla
// üretir (`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` tanımsız). Canlıya her yayından sonra açık kalan sayfa ESKİ kimlikle çağırır; sunucu
// `404 Server action not found` döner, istemcide söz (promise) REDDEDİLİR. Ürün formundaki öneri çağrısında `.catch` olmadığı için 5 sn
// beklenip yanıltıcı "Kod önerisi alınamadı" yazıyordu (aynı sayfadaki Kaydet de sessizce takılıyordu). Yerelde gerçek sunucuyla eski
// kimlik gönderilerek doğrulandı (T-990 kartı). Çözüm: (1) eski sürüm hatası tanınır ve kullanıcıya uygulamanın kendi penceresiyle
// "Uygulama güncellendi — Yenile" denir; (2) ortak eylem çağrıları reddi yakalar (`eylem`). Sürüm kimliği sabitleme (deploymentId /
// şifreleme anahtarı) imaj derlemesinde ayrı korunan iş (BACKLOG B-98).
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { KalipOnay } from "./pencere.tsx";

const OLAY = "kalip:eski-surum";

/** Reddin nedeni eski derlemenin Server Action kimliği mi? (Next: "Server Action "…" was not found on the server".) */
export function eskiSurumMu(e: unknown): boolean {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /server action .* was not found/i.test(m) || /failed to find server action/i.test(m);
}

/** Eski sürüm penceresini açar (bekçi kalıp kabındadır). */
export function eskiSurumBildir(): void {
  window.dispatchEvent(new Event(OLAY));
}

/**
 * Sunucu eylemini çağırır; reddi (ağ, eski sürüm) yakalar. Eski sürümde pencere açılır. Dönüş: eylemin sonucu ya da `null` (çağrı ulaşmadı).
 */
export async function eylem<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch (e) {
    if (eskiSurumMu(e)) eskiSurumBildir();
    return null;
  }
}

/** Kalıp kabına bir kez yerleşir: eski sürüm reddini (yakalanmamış olsa da) tanır, "Yenile" penceresini açar. */
export function KalipSurumBekcisi() {
  const t = useTranslations("kalip");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = (): void => setOpen(true);
    const onRej = (e: PromiseRejectionEvent): void => {
      if (!eskiSurumMu(e.reason)) return;
      e.preventDefault();
      show();
    };
    const onErr = (e: ErrorEvent): void => {
      if (eskiSurumMu(e.error ?? e.message)) show();
    };
    window.addEventListener(OLAY, show);
    window.addEventListener("unhandledrejection", onRej);
    window.addEventListener("error", onErr);
    return () => {
      window.removeEventListener(OLAY, show);
      window.removeEventListener("unhandledrejection", onRej);
      window.removeEventListener("error", onErr);
    };
  }, []);
  return (
    <KalipOnay
      open={open}
      variant="primary"
      title={t("updatedTitle")}
      description={t("updatedText")}
      confirmLabel={t("updatedReload")}
      cancelLabel={t("updatedLater")}
      onConfirm={() => window.location.reload()}
      onCancel={() => setOpen(false)}
    />
  );
}
