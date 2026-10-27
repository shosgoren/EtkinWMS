"use client";
// T-1059 (kullanıcı kararı 26 Ekim, "tüm listeler kaydırmayla"): sunucuda çizilen kart listelerinin ortak kaydırmalı devamı. Kartların
// verisi (ad, kod, ikon, adres, erişilebilir ad) SUNUCUDA hazırlanır — çeviri ve biçim kuralı istemcide yok; bu bileşen yalnız ilk
// sayfayı çizer, sona yaklaşınca ekranın okuma eylemiyle (`yukle`) sonrakini ekler (T-1055 kalıbı: `KalipSonsuz` + `useKalipDerinlik`).
import { useCallback, useMemo, useState } from "react";
import { KalipKart, KalipKartListe } from "./liste.tsx";
import { KalipSonsuz, useKalipDerinlik } from "./tablo.tsx";

/** Sunucuda hazırlanan tek kart (`KalipKart` görünüm alanları; işlev yok). */
export interface KalipKartVeri {
  readonly key: string;
  readonly name: string;
  readonly code: string;
  readonly meta?: string;
  readonly d: string;
  readonly color: string;
  readonly badge?: { readonly value: string; readonly sub: string };
  readonly tone?: "ok" | "crit" | "low";
  readonly href: string;
  readonly aria: string;
}

export interface KalipKartSayfasi {
  readonly kartlar: readonly KalipKartVeri[];
  readonly devam: string | null;
}

type Sonuc = { readonly ok: true; readonly data: KalipKartSayfasi } | { readonly ok: false };

/**
 * `sayi`: ilk sayfada bilinen toplam (yoksa yüklenen sayı). `sayiMetni` / `sayiFazla` sunucudan gelen çevrilmiş kalıplardır (`{n}` yer tutucu).
 * `yukle`: ekranın sunucu eylemi (slug + imleç alır; yetki ve tenant sınırı eylemde/domain'de).
 */
export function KalipKartAkisi({
  label,
  slug,
  ilk,
  toplam,
  sayiMetni,
  sayiFazla,
  yukle,
  kartTestId,
  testId,
}: {
  label: string;
  slug: string;
  ilk: KalipKartSayfasi;
  toplam?: number | undefined;
  sayiMetni: string;
  sayiFazla: string;
  yukle: (raw: { slug: string; after: string }) => Promise<Sonuc>;
  kartTestId?: string;
  testId: string;
}) {
  // Sunucu yeni ilk sayfa çizince (gezinme / yenileme) eklenenler sıfırlanır.
  const [ek, setEk] = useState<{ readonly bas: KalipKartSayfasi; readonly kartlar: readonly KalipKartVeri[]; readonly devam: string | null }>({ bas: ilk, kartlar: [], devam: ilk.devam });
  const guncel = ek.bas === ilk ? ek : { bas: ilk, kartlar: [], devam: ilk.devam };
  if (guncel !== ek) setEk(guncel);
  // Sonraki sayfalar arada kaymış olabilir: aynı kayıt iki kez çizilmez.
  const kartlar = useMemo(() => {
    const ilkler = new Set(ilk.kartlar.map((k) => k.key));
    return [...ilk.kartlar, ...guncel.kartlar.filter((k) => !ilkler.has(k.key))];
  }, [ilk, guncel.kartlar]);
  const devam = guncel.devam;
  const dahaYukle = useCallback(async (): Promise<boolean> => {
    if (devam === null) return true;
    const r = await yukle({ slug, after: devam });
    if (!r.ok) return false;
    setEk((o) => (o.bas !== ilk ? o : { bas: o.bas, kartlar: [...o.kartlar, ...r.data.kartlar], devam: r.data.devam }));
    return true;
  }, [devam, slug, yukle, ilk]);
  // Kayda girip geri dönünce aynı uzunluk (sunucudan taze; yalnız sayı hatırlanır).
  useKalipDerinlik(kartlar.length, devam !== null, dahaYukle);
  const metin = (toplam !== undefined ? sayiMetni : devam === null ? sayiMetni : sayiFazla).replace("{n}", String(toplam ?? kartlar.length));
  return (
    <KalipKartListe label={label}>
      {kartlar.map((k, i) => (
        <KalipKart
          key={k.key}
          index={i}
          name={k.name}
          code={k.code}
          {...(k.meta === undefined ? {} : { meta: k.meta })}
          d={k.d}
          color={k.color}
          {...(k.badge === undefined ? {} : { badge: k.badge })}
          {...(k.tone === undefined ? {} : { tone: k.tone })}
          href={k.href}
          aria={k.aria}
          {...(kartTestId === undefined ? {} : { testId: kartTestId })}
        />
      ))}
      <KalipSonsuz devam={devam !== null} yukle={dahaYukle} metin={metin} testId={testId} />
    </KalipKartListe>
  );
}
