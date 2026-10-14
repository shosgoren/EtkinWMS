DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.production_batches) OR EXISTS(SELECT 1 FROM public.production_packages)
 OR EXISTS(SELECT 1 FROM public.package_movement_steps WHERE operation='CONSUME')
 OR EXISTS(SELECT 1 FROM public.handling_units WHERE package_production_id IS NOT NULL) THEN
  RAISE EXCEPTION 'package production data exists; rollback refused' USING ERRCODE='23514';
 END IF;
END; $guard$;
DO $triggers$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['production_batches','production_packages','production_inputs','package_movement_steps','documents','document_lines','stock_ledger','stock_balances','stock_document_links'] LOOP
  EXECUTE format('DROP TRIGGER package_production_consistency ON public.%I',tab);
 END LOOP;
END; $triggers$;
DROP TRIGGER production_package_documents_guard ON public.documents;
DROP TRIGGER production_package_lines_guard ON public.document_lines;
CREATE OR REPLACE FUNCTION public.package_movement_assert(p_tenant uuid,p_package uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE origin record; step record; expected_line uuid; expected_location uuid; expected_status text; expected_seq integer:=1; expected_warehouse uuid;
 n integer; effects integer; out_effects integer; in_effects integer; positive_count integer; total numeric;
BEGIN
 IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN
  RAISE EXCEPTION 'PACKAGE_TENANT_CONTEXT_MISMATCH' USING ERRCODE='23514';
 END IF;
 SELECT l.*,d.warehouse_id,d.status AS document_status INTO origin
 FROM public.receipt_packages rp JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id
 JOIN public.documents d ON d.tenant_id=l.tenant_id AND d.id=l.document_id
 WHERE rp.tenant_id=p_tenant AND rp.id=p_package;
 IF NOT FOUND OR origin.document_status <> 'POSTED' OR origin.reversed_quantity<>0 OR origin.reversal_status<>'NONE' THEN
  RAISE EXCEPTION 'PACKAGE_MOVEMENT_ORIGIN' USING ERRCODE='23514';
 END IF;
 expected_warehouse:=origin.warehouse_id; expected_line:=origin.id; expected_location:=origin.target_location_id; expected_status:=origin.stock_status;
 FOR step IN SELECT * FROM public.package_movement_steps WHERE tenant_id=p_tenant AND handling_unit_id=p_package ORDER BY sequence_no LOOP
  IF step.sequence_no<>expected_seq OR step.previous_document_line_id<>expected_line
   OR step.source_location_id<>expected_location OR step.source_stock_status<>expected_status
   OR step.base_quantity<>origin.base_quantity THEN
   RAISE EXCEPTION 'PACKAGE_MOVEMENT_CHAIN' USING ERRCODE='23514';
  END IF;
  IF step.operation='WAREHOUSE_TRANSFER' THEN
   SELECT count(*) INTO n FROM public.documents d
   JOIN public.document_lines l ON l.tenant_id=d.tenant_id AND l.document_id=d.id
   JOIN public.documents out_doc ON out_doc.tenant_id=d.tenant_id AND out_doc.id=step.source_document_id
   JOIN public.document_lines out_line ON out_line.tenant_id=out_doc.tenant_id AND out_line.document_id=out_doc.id
   JOIN public.locations src ON src.tenant_id=d.tenant_id AND src.id=step.source_location_id
   JOIN public.locations dst ON dst.tenant_id=d.tenant_id AND dst.id=step.target_location_id
   JOIN public.stock_document_links link ON link.tenant_id=d.tenant_id AND link.source_document_id=out_doc.id AND link.target_document_id=d.id AND link.kind='TRANSFER'
   WHERE d.tenant_id=p_tenant AND d.id=step.document_id AND l.id=step.document_line_id AND out_line.id=step.source_document_line_id
    AND d.kind='STOCK_IN' AND out_doc.kind='STOCK_OUT' AND d.status='POSTED' AND out_doc.status='POSTED'
    AND out_doc.warehouse_id=expected_warehouse AND d.warehouse_id=dst.warehouse_id AND src.warehouse_id=expected_warehouse
    AND src.warehouse_id<>dst.warehouse_id AND src.kind IN ('RECEIVING','STORAGE') AND dst.kind='STORAGE'
    AND step.source_stock_status='AVAILABLE' AND step.target_stock_status='AVAILABLE'
    AND d.source_kind IS NULL AND d.source_id IS NULL AND d.reversal_of_document_id IS NULL
    AND out_doc.source_kind IS NULL AND out_doc.source_id IS NULL AND out_doc.reversal_of_document_id IS NULL
    AND (SELECT count(*) FROM public.document_lines x WHERE x.tenant_id=p_tenant AND x.document_id=d.id)=1
    AND (SELECT count(*) FROM public.document_lines x WHERE x.tenant_id=p_tenant AND x.document_id=out_doc.id)=1
    AND l.handling_unit_id=p_package AND out_line.handling_unit_id=p_package
    AND l.item_id=origin.item_id AND out_line.item_id=origin.item_id
    AND l.lot_id IS NOT DISTINCT FROM origin.lot_id AND out_line.lot_id IS NOT DISTINCT FROM origin.lot_id
    AND l.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id AND out_line.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id
    AND l.serial_id IS NULL AND out_line.serial_id IS NULL
    AND l.unit_id=origin.unit_id AND out_line.unit_id=origin.unit_id
    AND l.conversion_factor=origin.conversion_factor AND out_line.conversion_factor=origin.conversion_factor
    AND l.quantity=origin.quantity AND out_line.quantity=origin.quantity
    AND l.base_quantity=origin.base_quantity AND out_line.base_quantity=origin.base_quantity
    AND l.reversed_quantity=0 AND l.reversal_status='NONE' AND l.source_line_id IS NULL
    AND out_line.reversed_quantity=0 AND out_line.reversal_status='NONE' AND out_line.source_line_id IS NULL
    AND l.source_location_id IS NULL AND l.target_location_id=step.target_location_id
    AND out_line.source_location_id=step.source_location_id AND out_line.target_location_id IS NULL
    AND l.stock_status='AVAILABLE' AND coalesce(l.target_stock_status,l.stock_status)='AVAILABLE'
    AND out_line.stock_status='AVAILABLE' AND coalesce(out_line.target_stock_status,out_line.stock_status)='AVAILABLE';
   IF n<>1 THEN RAISE EXCEPTION 'PACKAGE_TRANSFER_LINE' USING ERRCODE='23514'; END IF;
   SELECT count(*),count(*) FILTER(WHERE sl.document_id=step.source_document_id AND sl.document_line_id=step.source_document_line_id
    AND sl.quantity=-step.base_quantity AND sd.location_id=step.source_location_id AND sd.stock_status='AVAILABLE'),
    count(*) FILTER(WHERE sl.document_id=step.document_id AND sl.document_line_id=step.document_line_id
    AND sl.quantity=step.base_quantity AND sd.location_id=step.target_location_id AND sd.stock_status='AVAILABLE')
    INTO effects,out_effects,in_effects
   FROM public.stock_ledger sl JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id
   WHERE sl.tenant_id=p_tenant AND sl.document_id IN (step.document_id,step.source_document_id)
    AND sd.handling_unit_id=p_package AND sd.item_id=origin.item_id AND sd.lot_id IS NOT DISTINCT FROM origin.lot_id
    AND sd.serial_id IS NULL AND sd.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id;
   IF effects<>2 OR out_effects<>1 OR in_effects<>1 OR
    (SELECT count(*) FROM public.stock_ledger WHERE tenant_id=p_tenant AND document_id IN (step.document_id,step.source_document_id))<>2 THEN
    RAISE EXCEPTION 'PACKAGE_TRANSFER_LEDGER' USING ERRCODE='23514';
   END IF;
   SELECT warehouse_id INTO expected_warehouse FROM public.locations WHERE tenant_id=p_tenant AND id=step.target_location_id;
  ELSE
  SELECT count(*) INTO n FROM public.documents d
  JOIN public.document_lines l ON l.tenant_id=d.tenant_id AND l.document_id=d.id
  JOIN public.locations src ON src.tenant_id=l.tenant_id AND src.id=l.source_location_id
  JOIN public.locations dst ON dst.tenant_id=l.tenant_id AND dst.id=l.target_location_id
  WHERE d.tenant_id=p_tenant AND d.id=step.document_id AND l.id=step.document_line_id
   AND d.kind='STOCK_MOVE' AND d.status='POSTED' AND d.warehouse_id=expected_warehouse
   AND d.source_kind IS NULL AND d.source_id IS NULL AND d.reversal_of_document_id IS NULL
   AND (SELECT count(*) FROM public.document_lines x WHERE x.tenant_id=p_tenant AND x.document_id=d.id)=1
   AND l.handling_unit_id=p_package AND l.item_id=origin.item_id AND l.lot_id IS NOT DISTINCT FROM origin.lot_id
   AND l.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id AND l.serial_id IS NULL
   AND l.unit_id=origin.unit_id AND l.conversion_factor=origin.conversion_factor
   AND l.quantity=origin.quantity AND l.base_quantity=origin.base_quantity
   AND l.reversed_quantity=0 AND l.reversal_status='NONE' AND l.source_line_id IS NULL
   AND l.source_location_id=step.source_location_id AND l.target_location_id=step.target_location_id
   AND l.stock_status=step.source_stock_status AND coalesce(l.target_stock_status,l.stock_status)=step.target_stock_status
   AND src.warehouse_id=expected_warehouse AND dst.warehouse_id=expected_warehouse
   AND ((step.operation='QC_RELEASE' AND step.source_location_id=step.target_location_id
    AND step.source_stock_status='QUARANTINE' AND step.target_stock_status='AVAILABLE')
    OR (step.operation='PUTAWAY' AND step.source_location_id<>step.target_location_id
    AND src.kind IN ('RECEIVING','STORAGE') AND dst.kind='STORAGE'
    AND step.source_stock_status='AVAILABLE' AND step.target_stock_status='AVAILABLE'));
  IF n<>1 THEN RAISE EXCEPTION 'PACKAGE_MOVEMENT_LINE' USING ERRCODE='23514'; END IF;
  SELECT count(*),count(*) FILTER(WHERE sl.quantity=-step.base_quantity AND sd.location_id=step.source_location_id
   AND sd.stock_status=step.source_stock_status),count(*) FILTER(WHERE sl.quantity=step.base_quantity
   AND sd.location_id=step.target_location_id AND sd.stock_status=step.target_stock_status)
   INTO effects,out_effects,in_effects
  FROM public.stock_ledger sl JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id
  WHERE sl.tenant_id=p_tenant AND sl.document_id=step.document_id AND sl.document_line_id=step.document_line_id
   AND sd.handling_unit_id=p_package AND sd.item_id=origin.item_id AND sd.lot_id IS NOT DISTINCT FROM origin.lot_id
   AND sd.serial_id IS NULL AND sd.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id;
  IF effects<>2 OR out_effects<>1 OR in_effects<>1 OR
   (SELECT count(*) FROM public.stock_ledger WHERE tenant_id=p_tenant AND document_id=step.document_id)<>2 THEN
   RAISE EXCEPTION 'PACKAGE_MOVEMENT_LEDGER' USING ERRCODE='23514';
  END IF;
  END IF;
  expected_line:=step.document_line_id; expected_location:=step.target_location_id; expected_status:=step.target_stock_status;
  expected_seq:=expected_seq+1;
 END LOOP;
 SELECT count(*) FILTER(WHERE b.quantity>0),coalesce(sum(b.quantity),0) INTO positive_count,total
 FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id
 WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p_package;
 IF positive_count<>1 OR total<>origin.base_quantity OR EXISTS(
  SELECT 1 FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id
  WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p_package AND b.quantity>0
   AND (sd.location_id<>expected_location OR sd.stock_status<>expected_status OR sd.item_id<>origin.item_id
    OR sd.lot_id IS DISTINCT FROM origin.lot_id OR sd.serial_id IS NOT NULL OR sd.inventory_owner_id IS DISTINCT FROM origin.inventory_owner_id)) THEN
  RAISE EXCEPTION 'PACKAGE_MOVEMENT_BALANCE' USING ERRCODE='23514';
 END IF;
END; $fn$;
CREATE OR REPLACE FUNCTION public.receipt_package_assert(p_tenant uuid,p_receipt uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE r record; d record; checks record; n integer; package_id uuid;
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
 -- Each callback still validates the full bounded receipt. Aggregate ledger and balance
 -- independently before joining, so multiple entries cannot multiply quantities.
 -- Resolve package/line identities before optional metadata enrichment. Keeping
 -- this boundary prevents repeated lot/location scans under low row estimates.
 -- Keep identity filtering inside the lookup before optional metadata joins.
 -- OFFSET 0 preserves all rows while retaining this planner boundary.
 WITH package_lines AS MATERIALIZED (
  SELECT rp.*, rl.receipt_id AS actual_receipt, rl.item_id AS receipt_item,rl.unit_id AS receipt_unit,
   rl.conversion_factor AS receipt_factor,rl.expected_quantity,rl.received_quantity,rl.damaged_quantity,
   l.item_id,l.unit_id,l.quantity,l.conversion_factor,l.base_quantity,l.handling_unit_id,l.lot_id,l.source_line_id,
   l.source_location_id,l.target_location_id,l.stock_status,l.target_stock_status,l.serial_id,l.inventory_owner_id,
   l.reversed_quantity
  FROM public.receipt_packages rp
  LEFT JOIN public.inbound_receipt_lines rl ON rl.tenant_id=rp.tenant_id AND rl.id=rp.receipt_line_id
  LEFT JOIN LATERAL (
   SELECT dl.* FROM public.document_lines dl
   WHERE dl.tenant_id=rp.tenant_id AND dl.id=rp.document_line_id AND dl.document_id=rp.document_id
   OFFSET 0
  ) l ON true
  WHERE rp.tenant_id=p_tenant AND rp.receipt_id=p_receipt
 ), origins AS MATERIALIZED (
  SELECT p.*,lot.item_id AS lot_item,lot.lot_code AS actual_lot_code,
   lot.production_date,lot.expiry_date,loc.warehouse_id AS target_warehouse
  FROM package_lines p
  LEFT JOIN public.lots lot ON lot.tenant_id=p.tenant_id AND lot.id=p.lot_id
  LEFT JOIN public.locations loc ON loc.tenant_id=p.tenant_id AND loc.id=p.target_location_id
 ), ledger_by_package AS MATERIALIZED (
  SELECT p.id,p.base_quantity,coalesce(sum(sl.quantity),0) AS total,
   coalesce(bool_or((NOT EXISTS(SELECT 1 FROM public.package_movement_steps ms
     WHERE ms.tenant_id=p_tenant AND ms.handling_unit_id=p.id AND ((ms.document_id=sl.document_id AND ms.document_line_id=sl.document_line_id)
      OR (ms.source_document_id=sl.document_id AND ms.source_document_line_id=sl.document_line_id)))
     AND (sl.document_id <> d.id OR sl.document_line_id <> p.document_line_id OR sl.quantity <= 0
      OR sd.location_id <> p.target_location_id OR sd.stock_status <> p.stock_status))
    OR sd.item_id <> p.item_id OR sd.lot_id IS DISTINCT FROM p.lot_id
    OR sd.serial_id IS NOT NULL OR sd.inventory_owner_id IS DISTINCT FROM p.inventory_owner_id)
    FILTER(WHERE sl.id IS NOT NULL),false) AS invalid
  FROM origins p
  LEFT JOIN public.stock_dimensions sd ON sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id
  LEFT JOIN public.stock_ledger sl ON sl.tenant_id=p_tenant AND sl.stock_dimension_id=sd.id
  GROUP BY p.id,p.base_quantity
 ), ledger_by_origin_line AS MATERIALIZED (
  SELECT p.id,bool_or(sd.handling_unit_id IS DISTINCT FROM p.id) AS invalid
  FROM origins p
  JOIN public.stock_ledger sl ON sl.tenant_id=p_tenant AND sl.document_id=d.id AND sl.document_line_id=p.document_line_id
  JOIN public.stock_dimensions sd ON sd.tenant_id=p_tenant AND sd.id=sl.stock_dimension_id
  GROUP BY p.id
 ), balance_by_package AS MATERIALIZED (
  SELECT p.id,p.base_quantity,coalesce(sum(b.quantity),0) AS total,
   count(DISTINCT sd.location_id) FILTER(WHERE b.quantity>0) AS positive_locations,
   coalesce(bool_or(b.quantity>0 AND (sd.item_id<>p.item_id OR sd.lot_id IS DISTINCT FROM p.lot_id))
    FILTER(WHERE b.stock_dimension_id IS NOT NULL),false) AS invalid
  FROM origins p
  LEFT JOIN public.stock_dimensions sd ON sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id
  LEFT JOIN public.stock_balances b ON b.tenant_id=p_tenant AND b.stock_dimension_id=sd.id
  GROUP BY p.id,p.base_quantity
 )
 -- Reduce independent package aggregates to flags without joining their rows.
 SELECT coalesce(bool_or(p.document_id <> d.id OR p.actual_receipt IS DISTINCT FROM r.id
  OR p.receipt_item IS DISTINCT FROM p.item_id OR p.receipt_unit IS DISTINCT FROM p.unit_id
  OR p.receipt_factor IS DISTINCT FROM p.conversion_factor OR p.expected_quantity IS DISTINCT FROM p.quantity
  OR p.quantity IS NULL OR p.quantity <= 0 OR p.base_quantity IS DISTINCT FROM p.quantity*p.conversion_factor
  OR p.handling_unit_id IS DISTINCT FROM p.id OR p.source_line_id IS DISTINCT FROM p.receipt_line_id
  OR p.source_location_id IS NOT NULL OR p.target_warehouse IS DISTINCT FROM r.warehouse_id
  OR p.stock_status NOT IN ('AVAILABLE','QUARANTINE') OR p.target_stock_status IS NOT NULL
  OR p.catalog_lot_id IS DISTINCT FROM p.lot_id OR p.serial_id IS NOT NULL OR p.reversed_quantity > p.base_quantity
  OR (p.lot_id IS NOT NULL AND (p.lot_code IS DISTINCT FROM p.actual_lot_code OR p.produced_on IS DISTINCT FROM p.production_date
  OR p.expires_on IS DISTINCT FROM p.expiry_date OR p.lot_item IS DISTINCT FROM p.item_id))),false) AS origin_line_invalid,
  coalesce(bool_or(p.damaged_quantity <> 0 OR p.received_quantity <> (CASE WHEN d.status='POSTED' THEN p.quantity ELSE 0 END)),false) AS counters_invalid,
  coalesce((SELECT bool_or(lo.invalid) FROM ledger_by_origin_line lo),false) AS ledger_dimension_invalid,
  coalesce((SELECT bool_or(lp.invalid) FROM ledger_by_package lp),false) AS ledger_origin_invalid,
  coalesce((SELECT bool_or(lp.total <> (CASE WHEN d.status='POSTED' THEN lp.base_quantity ELSE 0 END)) FROM ledger_by_package lp),false) AS ledger_quantity_invalid,
  coalesce((SELECT bool_or(bp.total>bp.base_quantity OR bp.positive_locations>1 OR (d.status <> 'POSTED' AND bp.total<>0) OR bp.invalid) FROM balance_by_package bp),false) AS balance_origin_invalid
 INTO checks
 FROM origins p;
 -- Deterministic category priority replaces unspecified package iteration order;
 -- single-fault categories and their predicates are unchanged.
 IF checks.origin_line_invalid THEN RAISE EXCEPTION 'PACKAGE_ORIGIN_LINE' USING ERRCODE='23514'; END IF;
 IF checks.counters_invalid THEN RAISE EXCEPTION 'PACKAGE_RECEIPT_COUNTERS' USING ERRCODE='23514'; END IF;
 IF checks.ledger_dimension_invalid THEN RAISE EXCEPTION 'PACKAGE_LEDGER_DIMENSION' USING ERRCODE='23514'; END IF;
 IF checks.ledger_origin_invalid THEN RAISE EXCEPTION 'PACKAGE_LEDGER_ORIGIN_ONLY' USING ERRCODE='23514'; END IF;
 IF checks.ledger_quantity_invalid THEN RAISE EXCEPTION 'PACKAGE_LEDGER_QUANTITY' USING ERRCODE='23514'; END IF;
 IF checks.balance_origin_invalid THEN RAISE EXCEPTION 'PACKAGE_BALANCE_ORIGIN' USING ERRCODE='23514'; END IF;
 FOR package_id IN SELECT DISTINCT ms.handling_unit_id FROM public.package_movement_steps ms
  JOIN public.receipt_packages rp ON rp.tenant_id=ms.tenant_id AND rp.id=ms.handling_unit_id
  WHERE rp.tenant_id=p_tenant AND rp.receipt_id=p_receipt LOOP
  PERFORM public.package_movement_assert(p_tenant,package_id);
 END LOOP;
END; $fn$;
CREATE OR REPLACE FUNCTION public.package_movement_check_trigger() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE package_id uuid;
BEGIN
 IF TG_TABLE_NAME='package_movement_steps' THEN package_id:=NEW.handling_unit_id;
 ELSE
  SELECT handling_unit_id INTO package_id FROM public.package_movement_steps WHERE tenant_id=NEW.tenant_id AND (document_id=NEW.id OR source_document_id=NEW.id);
 END IF;
 IF package_id IS NOT NULL THEN PERFORM public.package_movement_assert(NEW.tenant_id,package_id); END IF;
 RETURN NULL;
END; $fn$;
CREATE OR REPLACE FUNCTION public.handling_units_package_marker_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 IF NEW.package_receipt_id IS DISTINCT FROM OLD.package_receipt_id THEN
  RAISE EXCEPTION 'PACKAGE_HU_BINDING_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $fn$;
CREATE OR REPLACE FUNCTION public.package_transfer_link_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 IF TG_OP='TRUNCATE' THEN
  RAISE EXCEPTION 'PACKAGE_TRANSFER_LINK_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.package_movement_steps WHERE tenant_id=OLD.tenant_id
  AND operation='WAREHOUSE_TRANSFER' AND (source_document_id=OLD.source_document_id OR document_id=OLD.target_document_id)) THEN
  RAISE EXCEPTION 'PACKAGE_TRANSFER_LINK_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $fn$;
ALTER TABLE public.package_movement_steps DROP CONSTRAINT package_movement_steps_hu_fkey,
 DROP CONSTRAINT package_movement_steps_operation_check,DROP COLUMN production_batch_id,
 ADD CONSTRAINT package_movement_steps_tenant_id_handling_unit_id_fkey FOREIGN KEY(tenant_id,handling_unit_id) REFERENCES public.receipt_packages(tenant_id,id),
 ADD CONSTRAINT package_movement_steps_tenant_id_document_id_key UNIQUE(tenant_id,document_id),
 ADD CONSTRAINT package_movement_steps_operation_check CHECK(operation IN ('QC_RELEASE','PUTAWAY','WAREHOUSE_TRANSFER'));
ALTER TABLE public.handling_units DROP CONSTRAINT handling_units_production_pair_fkey;
DROP TABLE public.production_inputs;
DROP TABLE public.production_packages;
DROP TABLE public.production_batches;
ALTER TABLE public.handling_units DROP COLUMN package_production_id;
DROP FUNCTION public.package_production_check();
DROP FUNCTION public.package_production_guard();
DROP FUNCTION public.package_production_assert(uuid,uuid);
DROP FUNCTION public.package_origin(uuid,uuid);
