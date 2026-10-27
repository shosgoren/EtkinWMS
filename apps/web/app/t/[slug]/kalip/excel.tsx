"use client";
// Excel indirme yardımcıları (Ayarlar › Bağlantılar). T-1094 (kullanıcı kararı 27 Ekim): Excel yalnız Ayarlar › Entegrasyonlar'da; kalıp üst
// çubuğundaki Excel düğmesi ve menüsü (T-981b) kaldırıldı. Asıl yetki kararı sunucuda (`/api/t/<alan>/export/<tür>`).

export interface ExcelIndirSonuc {
  readonly ok: boolean;
  readonly rows?: number;
  readonly truncated?: boolean;
  readonly personalOmitted?: boolean;
  readonly code?: string;
  readonly detail?: string;
}

/**
 * Dışa aktarma / şablon dosyasını indirir (aynı site `fetch` → blob → indirme). Hata kodu yanıttan okunur (ekranda sade metin).
 * Bağlantılar sekmesi de bunu kullanır (tek davranış).
 */
export async function excelIndir(href: string): Promise<ExcelIndirSonuc> {
  try {
    const res = await fetch(href, { credentials: "same-origin", headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    if (!res.ok) {
      let code = "INTERNAL";
      let detail: string | undefined;
      try {
        const body = (await res.json()) as { error?: { code?: unknown; detail?: unknown } };
        if (typeof body.error?.code === "string") code = body.error.code;
        if (typeof body.error?.detail === "string") detail = body.error.detail;
      } catch {
        /* gövde yok */
      }
      return { ok: false, code, ...(detail === undefined ? {} : { detail }) };
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "etkin.xlsx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { ok: true, rows: Number(res.headers.get("x-export-rows") ?? "0"), truncated: res.headers.get("x-export-truncated") === "1", personalOmitted: res.headers.get("x-export-personal-omitted") === "1" };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

/** Kişisel veri dosyası yeniden giriş istedi: kısa balondan sonra yeniden giriş ekranı (dönüş bu sayfa). */
export function excelYenidenGiris(r: ExcelIndirSonuc): boolean {
  if (r.detail !== "RECENT_AUTH_REQUIRED") return false;
  const next = `${window.location.pathname}${window.location.search}`;
  window.setTimeout(() => window.location.assign(`/login?reauth=1&next=${encodeURIComponent(next)}`), 1600);
  return true;
}

/** Hata kodu → `baglantilar.err.*` anahtarı. */
export function excelHata(code: string | undefined, detail?: string): string {
  return detail === "RECENT_AUTH_REQUIRED" ? "reauth" : code === "RATE_LIMITED" ? "rate" : code === "FORBIDDEN" || code === "UNAUTHENTICATED" ? "forbidden" : code === "NETWORK" ? "network" : code === "NOT_FOUND" ? "notFound" : "generic";
}
