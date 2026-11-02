"use client";
// T-1201 (kullanıcı kararı 1 Kasım): "Paraşüt'ten al" seçili bölümde kaynak kilidi — ortak gösterim. Karar sunucuda (domain
// `integrations/source-guard.ts`); bu dosya yalnız ekranın kilitli düğme/alan gerekçesini ve "Şimdi eşitle" eylemini verir:
//   - yeni kart kilidi (bölüm yönetiliyor), sağlayıcı alanı ve arşiv kilidi (kart sağlayıcıya bağlı);
//   - gerekçe T-1141 yetki kilidinden ÖNCE gelir (daha özel: yetki verilse de açılmaz, sorumluna sormak çözmez);
//   - "Şimdi eşitle" yalnız entegrasyonu yönetebilen (`settings.manage`) kullanıcıya balonda çıkar; mevcut eşitleme kuyruğunu tetikler.
// Değer sunucu sayfasında `getSourceLock` (+ `settings.manage`) ile hesaplanıp prop olarak gelir; "use client" dosyası `@wms/domain`
// içe aktarmaz (T-127b) — tip aşağıda birebir yazılır (domain `SourceLockView` + `canSync`).
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { balonGoster, type BalonEylem } from "@wms/ui";
import { runIntegrationAction } from "../integrations/actions.ts";
import type { KartBolum } from "./kart-yetki.ts";
import { kilitliDokunus } from "./kilitli.tsx";

export interface KartKaynak {
  /** Bölüm sağlayıcıdan alınıyor (akış açık + PULL + bağlantı kesilmemiş). */
  readonly managed: boolean;
  /** Kart sağlayıcıya bağlı (listede ya da tek kartta). */
  readonly linked: boolean;
  /** Kullanıcı eşitlemeyi başlatabilir (`settings.manage`). */
  readonly canSync: boolean;
  readonly provider: "PARASUT" | "LOGO" | null;
}

export const KAYNAK_YOK: KartKaynak = Object.freeze({ managed: false, linked: false, canSync: false, provider: null });

export type KaynakBolum = Exclude<KartBolum, "locations">;
const FLOW: Readonly<Record<KaynakBolum, "PRODUCTS" | "CONTACTS" | "WAREHOUSES">> = { items: "PRODUCTS", parties: "CONTACTS", warehouses: "WAREHOUSES" };

export interface KaynakKilit {
  /** Yeni kart kilitli mi + gerekçe. */
  readonly create: boolean;
  readonly createReason: string;
  /** Kartın sağlayıcı alanları (ad, kod …) kilitli mi + gerekçe ("Paraşüt'ten geliyor — Paraşüt'te değiştir"). */
  readonly field: boolean;
  readonly fieldReason: string;
  /** Arşivle / geri aç kilitli mi + gerekçe. */
  readonly archive: boolean;
  readonly archiveReason: string;
  /** Kilit balonundaki "Şimdi eşitle" (yetki yoksa yok). */
  readonly eylem: BalonEylem | undefined;
  /** Sunucu `SOURCE_MANAGED_*` ayrıntısının ekran cümlesi (başka ayrıntıda null). */
  readonly hataMetni: (detail: string | undefined) => string | null;
}

/** Bölüm + kart kaynağı → kilitler. `linked` listede satır başına değişiyorsa `kart` ile o satırın değeri verilir. */
export function useKaynakKilit(slug: string, bolum: KaynakBolum, kaynak: KartKaynak, kart?: { readonly linked: boolean }): KaynakKilit {
  const t = useTranslations("kaynakKilit");
  const provider = kaynak.provider ?? "PARASUT";
  const sync = useCallback(async () => {
    const r = await runIntegrationAction({ slug, provider, flow: FLOW[bolum] });
    if (r.ok && r.data.ok) balonGoster(r.data.queued ? { tur: "ok", metin: t("syncQueued") } : { tur: "info", metin: t("syncBusy"), ses: false });
    else balonGoster({ tur: "err", metin: t("syncFailed") });
  }, [slug, provider, bolum, t]);
  const linked = kart?.linked ?? kaynak.linked;
  return useMemo(() => {
    const createReason = t(`create.${bolum}`);
    const fieldReason = t("field");
    const archiveReason = t("archive");
    const eylem: BalonEylem | undefined = kaynak.managed && kaynak.canSync ? { etiket: t("sync"), yap: sync } : undefined;
    return {
      create: kaynak.managed,
      createReason,
      field: kaynak.managed && linked,
      fieldReason,
      archive: kaynak.managed && linked,
      archiveReason,
      eylem,
      hataMetni: (detail) => (detail === "SOURCE_MANAGED_CREATE" ? createReason : detail === "SOURCE_MANAGED_FIELD" ? fieldReason : detail === "SOURCE_MANAGED_ARCHIVE" ? archiveReason : null),
    };
  }, [t, bolum, kaynak.managed, kaynak.canSync, linked, sync]);
}

/** `?new=1` yönetilen bölümde açıldı (rehber, ses, eski bağlantı): form açılmaz, neden bir kez kilit balonuyla söylenir. */
export function useKaynakYeniUyarisi(aktif: boolean, neden: string, eylem: BalonEylem | undefined): void {
  const dendi = useRef(false);
  useEffect(() => {
    if (!aktif || dendi.current) return;
    dendi.current = true;
    kilitliDokunus(neden, eylem);
  }, [aktif, neden, eylem]);
}
