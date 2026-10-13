-- Refuse to remove the immutable origin contract while any package identity exists.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.receipt_packages) OR EXISTS(SELECT 1 FROM public.inbound_receipts WHERE package_document_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.handling_units WHERE kind='VARIL') THEN
  RAISE EXCEPTION 'receipt package data exists; downgrade refused';
 END IF;
END; $guard$;
DO $triggers$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['inbound_receipts','inbound_receipt_lines','documents','document_lines','receipt_packages','stock_ledger','stock_balances'] LOOP
  EXECUTE format('DROP TRIGGER receipt_packages_consistency ON public.%I',tab);
 END LOOP;
END; $triggers$;
DROP TRIGGER receipt_packages_receipt_guard ON public.inbound_receipts;
DROP TRIGGER receipt_packages_document_guard ON public.documents;
DROP TRIGGER receipt_packages_line_guard ON public.document_lines;
DROP TRIGGER receipt_packages_receipt_line_guard ON public.inbound_receipt_lines;
DROP TRIGGER receipt_packages_lot_guard ON public.lots;
DROP TABLE public.receipt_packages;
ALTER TABLE public.lots DROP CONSTRAINT lots_package_snapshot_key, DROP COLUMN package_dates;
DROP FUNCTION public.receipt_package_check_trigger();
DROP FUNCTION public.receipt_package_is_mapped(text,jsonb);
DROP FUNCTION public.receipt_package_guard();
DROP FUNCTION public.receipt_package_assert(uuid,uuid);
ALTER TABLE public.inbound_receipts DROP COLUMN package_document_id;
ALTER TABLE public.handling_units DROP CONSTRAINT handling_units_kind_chk;
ALTER TABLE public.handling_units ADD CONSTRAINT handling_units_kind_chk CHECK(kind IN ('KOLI','PALET'));
