-- T-932: immutable receipt origins. No movement of mapped packages is enabled here.
ALTER TABLE public.inbound_receipts ADD COLUMN package_document_id uuid,
 ADD CONSTRAINT inbound_receipts_package_document_key UNIQUE (tenant_id, package_document_id),
 ADD CONSTRAINT inbound_receipts_package_document_fkey FOREIGN KEY (tenant_id, package_document_id)
 REFERENCES public.documents(tenant_id,id) DEFERRABLE INITIALLY DEFERRED;
GRANT INSERT (package_document_id) ON public.inbound_receipts TO wms_app;
ALTER TABLE public.handling_units DROP CONSTRAINT handling_units_kind_chk;
ALTER TABLE public.handling_units ADD CONSTRAINT handling_units_kind_chk CHECK(kind IN ('KOLI','PALET','VARIL'));
-- Arrays preserve nullable date elements while the composite FK itself has no NULL date key.
ALTER TABLE public.lots ADD COLUMN package_dates date[] GENERATED ALWAYS AS (ARRAY[production_date,expiry_date]) STORED NOT NULL,
 ADD CONSTRAINT lots_package_snapshot_key UNIQUE(tenant_id,id,lot_code,package_dates);
CREATE TABLE public.receipt_packages (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL,
 receipt_line_id uuid NOT NULL,
 document_id uuid NOT NULL,
 document_line_id uuid NOT NULL,
 package_no integer NOT NULL CHECK(package_no BETWEEN 1 AND 200),
 lot_code text,
 produced_on date,
 expires_on date,
 catalog_lot_id uuid,
 package_dates date[] GENERATED ALWAYS AS (ARRAY[produced_on,expires_on]) STORED NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,receipt_line_id), UNIQUE(tenant_id,document_line_id),
 UNIQUE(tenant_id,receipt_id,package_no),
 FOREIGN KEY(tenant_id,id) REFERENCES public.handling_units(tenant_id,id),
 FOREIGN KEY(tenant_id,receipt_id) REFERENCES public.inbound_receipts(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,receipt_line_id) REFERENCES public.inbound_receipt_lines(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,document_id) REFERENCES public.documents(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,document_id,document_line_id) REFERENCES public.document_lines(tenant_id,document_id,id) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT receipt_packages_lot_snapshot_fkey FOREIGN KEY(tenant_id,catalog_lot_id,lot_code,package_dates)
 REFERENCES public.lots(tenant_id,id,lot_code,package_dates) ON UPDATE NO ACTION ON DELETE NO ACTION,
 CHECK(catalog_lot_id IS NULL OR lot_code IS NOT NULL),
 CHECK(lot_code IS NULL OR btrim(lot_code) <> ''),
 CHECK(produced_on IS NULL OR expires_on IS NULL OR expires_on >= produced_on)
);
CREATE INDEX receipt_packages_tenant_document_idx ON public.receipt_packages(tenant_id,document_id);
ALTER TABLE public.receipt_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_packages_isolation ON public.receipt_packages
 USING(tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(pg_catalog.current_setting('app.current_tenant_id',true),'')::uuid);
REVOKE ALL ON public.receipt_packages FROM PUBLIC;
GRANT SELECT ON public.receipt_packages TO wms_app;
GRANT INSERT(tenant_id,id,receipt_id,receipt_line_id,document_id,document_line_id,package_no,lot_code,produced_on,expires_on,catalog_lot_id) ON public.receipt_packages TO wms_app;

CREATE FUNCTION public.receipt_package_assert(p_tenant uuid,p_receipt uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE r record; d record; p record; n integer; total numeric; positive_locations integer;
BEGIN
 SELECT * INTO r FROM public.inbound_receipts WHERE tenant_id=p_tenant AND id=p_receipt;
 IF NOT FOUND OR r.package_document_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.receipt_packages WHERE tenant_id=p_tenant AND receipt_id=p_receipt) THEN
   RAISE EXCEPTION 'PACKAGE_RECEIPT_BINDING' USING ERRCODE='23514';
  END IF;
  RETURN;
 END IF;
 IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN
  RAISE EXCEPTION 'PACKAGE_TENANT_CONTEXT_MISMATCH' USING ERRCODE='23514';
 END IF;
 SELECT * INTO d FROM public.documents WHERE tenant_id=p_tenant AND id=r.package_document_id;
 IF NOT FOUND OR d.kind <> 'STOCK_IN' OR d.source_kind IS DISTINCT FROM 'INBOUND_RECEIPT'
 OR d.source_id IS DISTINCT FROM r.id OR d.warehouse_id <> r.warehouse_id
 OR d.reversal_of_document_id IS NOT NULL OR d.status NOT IN ('DRAFT','APPROVED','POSTED') THEN
  RAISE EXCEPTION 'PACKAGE_ORIGIN_HEADER' USING ERRCODE='23514';
 END IF;
 -- This receipt callback also covers a source document inserted before the binding existed.
 -- documents_tenant_source_idx keeps the predicate bounded to this tenant/source identity.
 IF EXISTS(SELECT 1 FROM public.documents WHERE tenant_id=p_tenant AND source_kind='INBOUND_RECEIPT'
  AND source_id=p_receipt AND id<>d.id) THEN
  RAISE EXCEPTION 'PACKAGE_SOURCE_DOCUMENT_BYPASS' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO n FROM public.receipt_packages WHERE tenant_id=p_tenant AND receipt_id=p_receipt;
 IF n NOT BETWEEN 1 AND 200
 OR n <> (SELECT count(*) FROM public.inbound_receipt_lines WHERE tenant_id=p_tenant AND receipt_id=p_receipt)
 OR n <> (SELECT count(*) FROM public.document_lines WHERE tenant_id=p_tenant AND document_id=d.id) THEN
  RAISE EXCEPTION 'PACKAGE_LINE_COVERAGE' USING ERRCODE='23514';
 END IF;
 IF (d.status='POSTED' AND r.status <> 'CLOSED') OR (d.status <> 'POSTED' AND r.status NOT IN ('DRAFT','OPEN')) THEN
  RAISE EXCEPTION 'PACKAGE_RECEIPT_STATUS' USING ERRCODE='23514';
 END IF;
 FOR p IN
  SELECT rp.*, rl.receipt_id AS actual_receipt, rl.item_id AS receipt_item,rl.unit_id AS receipt_unit,
   rl.conversion_factor AS receipt_factor,rl.expected_quantity,rl.received_quantity,rl.damaged_quantity,
   l.item_id,l.unit_id,l.quantity,l.conversion_factor,l.base_quantity,l.handling_unit_id,l.lot_id,l.source_line_id,
   l.source_location_id,l.target_location_id,l.stock_status,l.target_stock_status,l.serial_id,l.inventory_owner_id,
   l.reversed_quantity,lot.item_id AS lot_item,lot.lot_code AS actual_lot_code,
   lot.production_date,lot.expiry_date,loc.warehouse_id AS target_warehouse
  FROM public.receipt_packages rp
  LEFT JOIN public.inbound_receipt_lines rl ON rl.tenant_id=rp.tenant_id AND rl.id=rp.receipt_line_id
  LEFT JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id AND l.document_id=rp.document_id
  LEFT JOIN public.lots lot ON lot.tenant_id=l.tenant_id AND lot.id=l.lot_id
  LEFT JOIN public.locations loc ON loc.tenant_id=l.tenant_id AND loc.id=l.target_location_id
  WHERE rp.tenant_id=p_tenant AND rp.receipt_id=p_receipt
 LOOP
  IF p.document_id <> d.id OR p.actual_receipt IS DISTINCT FROM r.id
  OR p.receipt_item IS DISTINCT FROM p.item_id OR p.receipt_unit IS DISTINCT FROM p.unit_id
  OR p.receipt_factor IS DISTINCT FROM p.conversion_factor OR p.expected_quantity IS DISTINCT FROM p.quantity
  OR p.quantity IS NULL OR p.quantity <= 0 OR p.base_quantity IS DISTINCT FROM p.quantity*p.conversion_factor
  OR p.handling_unit_id IS DISTINCT FROM p.id OR p.source_line_id IS DISTINCT FROM p.receipt_line_id
  OR p.source_location_id IS NOT NULL OR p.target_warehouse IS DISTINCT FROM r.warehouse_id
  OR p.stock_status NOT IN ('AVAILABLE','QUARANTINE') OR p.target_stock_status IS NOT NULL
  OR p.catalog_lot_id IS DISTINCT FROM p.lot_id OR p.serial_id IS NOT NULL OR p.reversed_quantity > p.base_quantity
  OR (p.lot_id IS NOT NULL AND (p.lot_code IS DISTINCT FROM p.actual_lot_code OR p.produced_on IS DISTINCT FROM p.production_date
  OR p.expires_on IS DISTINCT FROM p.expiry_date OR p.lot_item IS DISTINCT FROM p.item_id)) THEN
   RAISE EXCEPTION 'PACKAGE_ORIGIN_LINE' USING ERRCODE='23514';
  END IF;
  IF p.damaged_quantity <> 0 OR p.received_quantity <> (CASE WHEN d.status='POSTED' THEN p.quantity ELSE 0 END) THEN
   RAISE EXCEPTION 'PACKAGE_RECEIPT_COUNTERS' USING ERRCODE='23514';
  END IF;
  -- All checks are tenant/HU indexed. They are consistency checks, not a concurrency lock.
  IF EXISTS(SELECT 1 FROM public.stock_ledger sl JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id
   WHERE sl.tenant_id=p_tenant AND sl.document_id=d.id AND sl.document_line_id=p.document_line_id AND sd.handling_unit_id IS DISTINCT FROM p.id) THEN
   RAISE EXCEPTION 'PACKAGE_LEDGER_DIMENSION' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.stock_dimensions sd JOIN public.stock_ledger sl ON sl.tenant_id=sd.tenant_id AND sl.stock_dimension_id=sd.id
    WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id AND
    (sl.document_id <> d.id OR sl.document_line_id <> p.document_line_id OR sl.quantity <= 0
     OR sd.item_id <> p.item_id OR sd.lot_id IS DISTINCT FROM p.lot_id
     OR sd.location_id <> p.target_location_id OR sd.stock_status <> p.stock_status
     OR sd.serial_id IS NOT NULL OR sd.inventory_owner_id IS DISTINCT FROM p.inventory_owner_id)) THEN
   RAISE EXCEPTION 'PACKAGE_LEDGER_ORIGIN_ONLY' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(sl.quantity),0) INTO total FROM public.stock_ledger sl
   JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id
   WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id;
  IF total <> (CASE WHEN d.status='POSTED' THEN p.base_quantity ELSE 0 END) THEN
   RAISE EXCEPTION 'PACKAGE_LEDGER_QUANTITY' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(b.quantity),0),count(DISTINCT sd.location_id) FILTER(WHERE b.quantity>0)
   INTO total,positive_locations FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id
   WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id;
  IF total>p.base_quantity OR positive_locations>1 OR (d.status <> 'POSTED' AND total<>0)
  OR EXISTS(SELECT 1 FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id
   WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id AND b.quantity>0
   AND (sd.item_id<>p.item_id OR sd.lot_id IS DISTINCT FROM p.lot_id)) THEN
   RAISE EXCEPTION 'PACKAGE_BALANCE_ORIGIN' USING ERRCODE='23514';
  END IF;
 END LOOP;
END; $fn$;
REVOKE ALL ON FUNCTION public.receipt_package_assert(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_package_assert(uuid,uuid) TO wms_app;

CREATE FUNCTION public.receipt_package_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE t uuid; linked boolean := false; origin_id uuid;
BEGIN
 IF TG_TABLE_NAME='receipt_packages' AND TG_OP='TRUNCATE' THEN
  RAISE EXCEPTION 'PACKAGE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN t:=OLD.tenant_id; ELSE t:=NEW.tenant_id; END IF;
 IF TG_TABLE_NAME='receipt_packages' THEN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'PACKAGE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  linked:=true;
  NEW.created_at:=now();
 ELSIF TG_TABLE_NAME='inbound_receipts' THEN
  linked:=NEW.package_document_id IS NOT NULL;
  IF TG_OP='UPDATE' AND NEW.package_document_id IS DISTINCT FROM OLD.package_document_id THEN
   RAISE EXCEPTION 'PACKAGE_BINDING_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.package_document_id IS NOT NULL AND
   (NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
   RAISE EXCEPTION 'PACKAGE_HEADER_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='documents' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.source_kind='INBOUND_RECEIPT' THEN
    -- Runtime foreign INSERT belongs to FORCE RLS WITH CHECK, before any parent lookup.
    IF current_user='wms_app' AND t IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN RETURN NEW; END IF;
    -- No lock: a source must already see its real parent, whose binding can never change.
    -- This also rejects an uncommitted/new parent hidden by a concurrent RR snapshot.
    SELECT package_document_id INTO origin_id FROM public.inbound_receipts WHERE tenant_id=t AND id=NEW.source_id;
    IF NOT FOUND THEN
     RAISE EXCEPTION 'PACKAGE_SOURCE_RECEIPT_REQUIRED' USING ERRCODE='23514';
    END IF;
    IF origin_id IS NOT NULL AND origin_id IS DISTINCT FROM NEW.id THEN
     RAISE EXCEPTION 'PACKAGE_SOURCE_DOCUMENT_BYPASS' USING ERRCODE='23514';
    END IF;
    linked:=origin_id IS NOT NULL;
   END IF;
  ELSE
   SELECT EXISTS(SELECT 1 FROM public.inbound_receipts WHERE tenant_id=t AND package_document_id=OLD.id) INTO linked;
  IF linked AND (TG_OP='DELETE' OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
   OR NEW.business_date IS DISTINCT FROM OLD.business_date OR NEW.source_kind IS DISTINCT FROM OLD.source_kind OR NEW.source_id IS DISTINCT FROM OLD.source_id) THEN
   RAISE EXCEPTION 'PACKAGE_HEADER_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  END IF;
 ELSIF TG_TABLE_NAME='document_lines' THEN
  SELECT EXISTS(SELECT 1 FROM public.inbound_receipts WHERE tenant_id=t AND package_document_id=OLD.document_id) INTO linked;
  IF linked AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['reversed_quantity','reversal_status']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reversed_quantity','reversal_status'])) THEN
   RAISE EXCEPTION 'PACKAGE_ORIGIN_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='inbound_receipt_lines' THEN
  SELECT EXISTS(SELECT 1 FROM public.inbound_receipts WHERE tenant_id=t AND id=OLD.receipt_id AND package_document_id IS NOT NULL) INTO linked;
  IF linked AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['received_quantity','damaged_quantity']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['received_quantity','damaged_quantity'])) THEN
   RAISE EXCEPTION 'PACKAGE_ORIGIN_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='lots' THEN
  -- Use lot -> document line index, then package line unique key; lock only this lot via UPDATE itself.
  SELECT EXISTS(SELECT 1 FROM public.document_lines l JOIN public.receipt_packages rp ON rp.tenant_id=l.tenant_id AND rp.document_line_id=l.id
   WHERE l.tenant_id=t AND l.lot_id=OLD.id) INTO linked;
  IF EXISTS(SELECT 1 FROM public.document_lines l JOIN public.receipt_packages rp ON rp.tenant_id=l.tenant_id AND rp.document_line_id=l.id
   WHERE l.tenant_id=t AND l.lot_id=OLD.id AND (rp.lot_code IS DISTINCT FROM NEW.lot_code
    OR rp.produced_on IS DISTINCT FROM NEW.production_date OR rp.expires_on IS DISTINCT FROM NEW.expiry_date)) THEN
   RAISE EXCEPTION 'PACKAGE_LOT_SNAPSHOT' USING ERRCODE='23514';
  END IF;
 END IF;
 IF linked AND t IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN
  -- For runtime INSERT the existing FORCE RLS WITH CHECK is the foreign-tenant denial authority.
  IF TG_OP='INSERT' AND current_user='wms_app' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'PACKAGE_TENANT_CONTEXT_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.receipt_package_guard() FROM PUBLIC;
CREATE TRIGGER receipt_packages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.receipt_packages FOR EACH ROW EXECUTE FUNCTION public.receipt_package_guard();
CREATE TRIGGER receipt_packages_no_truncate BEFORE TRUNCATE ON public.receipt_packages FOR EACH STATEMENT EXECUTE FUNCTION public.receipt_package_guard();
CREATE TRIGGER receipt_packages_receipt_guard BEFORE INSERT OR UPDATE ON public.inbound_receipts FOR EACH ROW EXECUTE FUNCTION public.receipt_package_guard();
CREATE TRIGGER receipt_packages_document_guard BEFORE INSERT OR UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.receipt_package_guard();
CREATE TRIGGER receipt_packages_line_guard BEFORE UPDATE OR DELETE ON public.document_lines FOR EACH ROW EXECUTE FUNCTION public.receipt_package_guard();
CREATE TRIGGER receipt_packages_receipt_line_guard BEFORE UPDATE OR DELETE ON public.inbound_receipt_lines FOR EACH ROW EXECUTE FUNCTION public.receipt_package_guard();
CREATE TRIGGER receipt_packages_lot_guard BEFORE UPDATE ON public.lots FOR EACH ROW EXECUTE FUNCTION public.receipt_package_guard();

-- WHEN is evaluated at row-write time: legacy rows must not acquire new deferred events.
-- Final receipt checks still cover children inserted before mapping in the same transaction.
CREATE FUNCTION public.receipt_package_is_mapped(p_table text,p_row jsonb) RETURNS boolean
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE t uuid:=(p_row->>'tenant_id')::uuid; key_id uuid;
BEGIN
 IF p_table='receipt_packages' THEN RETURN true;
 ELSIF p_table='inbound_receipts' THEN RETURN p_row->>'package_document_id' IS NOT NULL;
 ELSIF p_table='inbound_receipt_lines' THEN
  RETURN EXISTS(SELECT 1 FROM public.inbound_receipts WHERE tenant_id=t AND id=(p_row->>'receipt_id')::uuid AND package_document_id IS NOT NULL);
 ELSIF p_table IN ('documents','document_lines') THEN
  key_id:=CASE WHEN p_table='documents' THEN (p_row->>'id')::uuid ELSE (p_row->>'document_id')::uuid END;
  RETURN EXISTS(SELECT 1 FROM public.inbound_receipts WHERE tenant_id=t AND
   (package_document_id=key_id OR (p_table='documents' AND p_row->>'source_kind'='INBOUND_RECEIPT' AND id=(p_row->>'source_id')::uuid AND package_document_id IS NOT NULL)));
 ELSE
  RETURN EXISTS(SELECT 1 FROM public.stock_dimensions sd JOIN public.receipt_packages rp ON rp.tenant_id=sd.tenant_id AND rp.id=sd.handling_unit_id
   WHERE sd.tenant_id=t AND sd.id=(p_row->>'stock_dimension_id')::uuid)
   OR (p_table='stock_ledger' AND EXISTS(SELECT 1 FROM public.inbound_receipts WHERE tenant_id=t AND package_document_id=(p_row->>'document_id')::uuid));
 END IF;
END; $fn$;
REVOKE ALL ON FUNCTION public.receipt_package_is_mapped(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receipt_package_is_mapped(text,jsonb) TO wms_app;

CREATE FUNCTION public.receipt_package_check_trigger() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE t uuid:=NEW.tenant_id; r uuid; dim uuid;
BEGIN
 -- Runtime context is checked before RLS can hide a queued row on context switch.
 IF current_user IN ('wms_app','wms_worker','wms_auth') AND t IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN
  RAISE EXCEPTION 'PACKAGE_TENANT_CONTEXT_MISMATCH' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='inbound_receipts' THEN r:=NEW.id;
 ELSIF TG_TABLE_NAME IN ('receipt_packages','inbound_receipt_lines') THEN r:=NEW.receipt_id;
 ELSIF TG_TABLE_NAME IN ('documents','document_lines') THEN
  IF TG_TABLE_NAME='documents' AND to_jsonb(NEW)->>'source_kind'='INBOUND_RECEIPT' AND EXISTS(SELECT 1 FROM public.inbound_receipts WHERE tenant_id=t AND id=(to_jsonb(NEW)->>'source_id')::uuid AND package_document_id IS NOT NULL AND package_document_id<>(to_jsonb(NEW)->>'id')::uuid) THEN
   RAISE EXCEPTION 'PACKAGE_SOURCE_DOCUMENT_BYPASS' USING ERRCODE='23514';
  END IF;
  SELECT id INTO r FROM public.inbound_receipts WHERE tenant_id=t AND package_document_id=CASE WHEN TG_TABLE_NAME='documents' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'document_id')::uuid END;
 ELSE
  dim:=NEW.stock_dimension_id;
  SELECT rp.receipt_id INTO r FROM public.stock_dimensions sd JOIN public.receipt_packages rp ON rp.tenant_id=sd.tenant_id AND rp.id=sd.handling_unit_id WHERE sd.tenant_id=t AND sd.id=dim;
  IF r IS NULL AND TG_TABLE_NAME='stock_ledger' THEN
   SELECT id INTO r FROM public.inbound_receipts WHERE tenant_id=t AND package_document_id=(to_jsonb(NEW)->>'document_id')::uuid;
  END IF;
 END IF;
 IF r IS NOT NULL THEN PERFORM public.receipt_package_assert(t,r); END IF;
 RETURN NULL;
END; $fn$;
REVOKE ALL ON FUNCTION public.receipt_package_check_trigger() FROM PUBLIC;
DO $triggers$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['inbound_receipts','inbound_receipt_lines','documents','document_lines','receipt_packages','stock_ledger','stock_balances'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER receipt_packages_consistency AFTER INSERT OR UPDATE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (public.receipt_package_is_mapped(%L,to_jsonb(NEW))) EXECUTE FUNCTION public.receipt_package_check_trigger()',tab,tab);
 END LOOP;
END; $triggers$;
