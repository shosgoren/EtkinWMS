// T-1034 / T-1043: doğrulama uygulamalarının resmî mağaza sayfaları ve "telefona göre doğru mağaza" seçimi. Sunucu (`/help/indir/<uygulama>`
// yönlendirmesi) ve istemci (kurulum sihirbazı) aynı tabloyu kullanır; hedefler sabittir (açık yönlendirme yok).

/** Resmî mağaza sayfaları (uygulama kimlikleri yayıncının kendi sayfalarından). */
export const MAGAZA = {
  google: {
    ios: "https://apps.apple.com/app/google-authenticator/id388497605",
    android: "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2",
  },
  microsoft: {
    ios: "https://apps.apple.com/app/microsoft-authenticator/id983156458",
    android: "https://play.google.com/store/apps/details?id=com.azure.authenticator",
  },
} as const;

export type DogrulamaUygulamasi = keyof typeof MAGAZA;

export function dogrulamaUygulamasiMi(x: string): x is DogrulamaUygulamasi {
  return Object.prototype.hasOwnProperty.call(MAGAZA, x);
}

/** Telefonun işletim sistemine göre mağaza: iPhone/iPad → App Store; diğerleri (Android, bilinmeyen) → Google Play. */
export function magazaAdresi(app: DogrulamaUygulamasi, ua: string): string {
  // iPadOS 13+ masaüstü Safari kimliği gönderir ("Macintosh"); dokunmatik Mac yok, bu yüzden "Mobile" ile birlikte iPad sayılır.
  const apple = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
  return apple ? MAGAZA[app].ios : MAGAZA[app].android;
}
