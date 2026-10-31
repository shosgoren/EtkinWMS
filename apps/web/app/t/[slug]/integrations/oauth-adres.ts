// T-1133: kendi Paraşüt uygulaması formunda gösterilen VE kopyalanan dönüş adresi tek kaynaktan gelir (PR inceleme: OOB açıkken Kopyala
// HTTPS callback'i kopyalıyordu). OOB seçiliyse Paraşüt'e yazılacak değer URN'dir; değilse sunucunun gerçek callback'i (yoksa null).
export const OOB_DONUS = "urn:ietf:wg:oauth:2.0:oob";
export function donusAdresi(oob: boolean, callbackUrl: string | null): string | null {
  return oob ? OOB_DONUS : callbackUrl;
}
