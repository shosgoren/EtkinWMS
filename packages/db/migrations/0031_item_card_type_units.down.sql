-- 0031 geri alma: kart türü sütunu kaldırılır. Standart birimler SİLİNMEZ: ürünler/dönüşümler/barkodlar bu birimlere
-- bağlanmış olabilir (FK) ve kullanıcı birimleriyle ayırt edilemez; birim kaydı kalmak veri kaybına yol açmaz.
REVOKE UPDATE (card_type) ON public.items FROM wms_app;
REVOKE INSERT (card_type) ON public.items FROM wms_app;
DROP INDEX public.items_tenant_card_type_idx;
ALTER TABLE public.items DROP CONSTRAINT items_card_type_chk;
ALTER TABLE public.items DROP COLUMN card_type;
