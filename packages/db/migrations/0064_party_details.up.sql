-- 0064_party_details (T-1117, kullanıcı 28 Ekim; onaylı tuval `StandartYeniCari.dc.html`): cari kartına Kısa ad, İlçe ve Varsayılan teslimat.
-- G-08: yalnız GENİŞLETME — üç yeni sütun (ikisi boş geçilebilir, teslimat varsayılanlı), CHECK'ler ve sütun yetkileri; mevcut satırlar
-- varsayılanla (`OWN` = kendi personelim) geçerlidir.
--
-- BİLİNÇLİ KARARLAR (inceleme için):
-- * `short_name` listede görünen ad (≤ 100, kontrol karakteri yok; ünvan kuralıyla aynı biçim). `district` ilçe (≤ 100; `city` gibi).
-- * `delivery_mode` yalnız iki değer: `OWN` (kendi personelim) / `CARRIER` (kargo firması). Sevkiyatta otomatik karar vermez; varsayılan
--   seçimdir (ekran ve aktarım).
-- * Yazan yalnız `wms_app`, yalnız bu sütunlar (0050'deki INSERT/UPDATE sütun yetkileri genişletilir; SELECT tablo düzeyinde zaten var).
--   Komutlar `settings.manage` / `data.import` ister ve audit yazar (I-12). RLS değişmez.
-- Koşturucu tek transaction içinde çalıştırır.

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenant_settings' AND column_name = 'voice_reply') THEN
    RAISE EXCEPTION '0064_party_details: 0063 önkoşulu yok';
  END IF;
  IF pg_catalog.to_regclass('public.parties') IS NULL THEN
    RAISE EXCEPTION '0064_party_details: public.parties yok';
  END IF;
END
$pre$;

ALTER TABLE public.parties
  ADD COLUMN short_name    text,
  ADD COLUMN district      text,
  ADD COLUMN delivery_mode text NOT NULL DEFAULT 'OWN';
ALTER TABLE public.parties
  ADD CONSTRAINT parties_short_name_chk CHECK (short_name IS NULL OR (char_length(short_name) BETWEEN 1 AND 100 AND short_name !~ '[[:cntrl:]]')),
  ADD CONSTRAINT parties_district_chk CHECK (district IS NULL OR (char_length(district) BETWEEN 1 AND 100 AND district !~ '[[:cntrl:]]')),
  ADD CONSTRAINT parties_delivery_mode_chk CHECK (delivery_mode IN ('OWN', 'CARRIER'));

GRANT INSERT (short_name, district, delivery_mode) ON public.parties TO wms_app;
GRANT UPDATE (short_name, district, delivery_mode) ON public.parties TO wms_app;

DO $verify$
DECLARE
  r text;
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['short_name', 'district', 'delivery_mode'] LOOP
    IF NOT pg_catalog.has_column_privilege('wms_app', 'public.parties', c, 'INSERT')
       OR NOT pg_catalog.has_column_privilege('wms_app', 'public.parties', c, 'UPDATE')
       OR NOT pg_catalog.has_column_privilege('wms_app', 'public.parties', c, 'SELECT') THEN
      RAISE EXCEPTION '0064_party_details: wms_app % sütununu okuyamıyor/yazamıyor', c;
    END IF;
    FOREACH r IN ARRAY ARRAY['wms_auth', 'wms_worker'] LOOP
      IF pg_catalog.to_regrole(r) IS NOT NULL
         AND (pg_catalog.has_column_privilege(r, 'public.parties', c, 'INSERT') OR pg_catalog.has_column_privilege(r, 'public.parties', c, 'UPDATE')) THEN
        RAISE EXCEPTION '0064_party_details: % rolü % sütununu yazabiliyor', r, c;
      END IF;
    END LOOP;
  END LOOP;
  IF pg_catalog.has_table_privilege('wms_app', 'public.parties', 'DELETE') THEN
    RAISE EXCEPTION '0064_party_details: wms_app silebiliyor';
  END IF;
END
$verify$;
