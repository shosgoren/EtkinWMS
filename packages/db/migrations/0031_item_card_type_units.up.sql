-- 0031_item_card_type_units (T-911): ürün kartı türü + standart birim seti.
--
-- 1. `items.card_type`: Hammadde (HM), Yarı Mamul (YM), Mamul (MM), Ticari Mal (TM). Mevcut satırlar 'TM' (ticari mal; en
--    güvenli varsayılan: üretim reçetesine girdi/çıktı olarak bağlanmaz). Otomatik ürün kodu bu türün önekiyle üretilir
--    (`HM-000001`); kural domain'dedir (code-suggest.ts), DB yalnızca değer kümesini korur.
-- 2. Standart birimler: her tenant'a ADET, KG, GR, MT, CM, LT, M2, M3, KOLI, PALET (kod çakışırsa dokunulmaz; mevcut
--    kayıt korunur). RLS FORCE olduğundan tenant bağlamı satır satır `set_config` ile kurulur; politika koşulu sağlanır.
--    Yeni tenant'lar için aynı küme domain'de (`seedStandardUnits`) kurulur; bu migration yalnızca MEVCUT tenant'ları tamamlar.
-- GRANT: wms_app `card_type` sütununa INSERT/UPDATE alır (0011 sütun bazlı yetki deseni); başka yetki değişmez.
ALTER TABLE public.items
  ADD COLUMN card_type text NOT NULL DEFAULT 'TM',
  ADD CONSTRAINT items_card_type_chk CHECK (card_type IN ('HM', 'YM', 'MM', 'TM'));
CREATE INDEX items_tenant_card_type_idx ON public.items (tenant_id, card_type);

GRANT INSERT (card_type) ON public.items TO wms_app;
GRANT UPDATE (card_type) ON public.items TO wms_app;

DO $seed$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM pg_catalog.set_config('app.current_tenant_id', t::text, true);
    INSERT INTO public.units (tenant_id, id, code, name)
    SELECT t, gen_random_uuid(), s.code, s.name
    FROM (VALUES
      ('ADET', 'Adet'), ('KG', 'Kilogram'), ('GR', 'Gram'), ('MT', 'Metre'), ('CM', 'Santimetre'),
      ('LT', 'Litre'), ('M2', 'Metrekare'), ('M3', 'Metreküp'), ('KOLI', 'Koli'), ('PALET', 'Palet')
    ) AS s(code, name)
    ON CONFLICT ON CONSTRAINT units_tenant_code_key DO NOTHING;
  END LOOP;
  PERFORM pg_catalog.set_config('app.current_tenant_id', '', true);
END
$seed$;
