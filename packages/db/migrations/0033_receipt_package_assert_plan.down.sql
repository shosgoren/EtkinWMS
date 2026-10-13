-- Restore the exact 0032 function body; no package or stock data is removed.
CREATE OR REPLACE FUNCTION public.receipt_package_assert(p_tenant uuid,p_receipt uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE r record; d record; checks record; n integer;
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
 WITH package_lines AS MATERIALIZED (
  SELECT rp.*, rl.receipt_id AS actual_receipt, rl.item_id AS receipt_item,rl.unit_id AS receipt_unit,
   rl.conversion_factor AS receipt_factor,rl.expected_quantity,rl.received_quantity,rl.damaged_quantity,
   l.item_id,l.unit_id,l.quantity,l.conversion_factor,l.base_quantity,l.handling_unit_id,l.lot_id,l.source_line_id,
   l.source_location_id,l.target_location_id,l.stock_status,l.target_stock_status,l.serial_id,l.inventory_owner_id,
   l.reversed_quantity
  FROM public.receipt_packages rp
  LEFT JOIN public.inbound_receipt_lines rl ON rl.tenant_id=rp.tenant_id AND rl.id=rp.receipt_line_id
  LEFT JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id AND l.document_id=rp.document_id
  WHERE rp.tenant_id=p_tenant AND rp.receipt_id=p_receipt
 ), origins AS MATERIALIZED (
  SELECT p.*,lot.item_id AS lot_item,lot.lot_code AS actual_lot_code,
   lot.production_date,lot.expiry_date,loc.warehouse_id AS target_warehouse
  FROM package_lines p
  LEFT JOIN public.lots lot ON lot.tenant_id=p.tenant_id AND lot.id=p.lot_id
  LEFT JOIN public.locations loc ON loc.tenant_id=p.tenant_id AND loc.id=p.target_location_id
 ), ledger_by_package AS MATERIALIZED (
  SELECT p.id,coalesce(sum(sl.quantity),0) AS total,
   coalesce(bool_or(sl.document_id <> d.id OR sl.document_line_id <> p.document_line_id OR sl.quantity <= 0
    OR sd.item_id <> p.item_id OR sd.lot_id IS DISTINCT FROM p.lot_id
    OR sd.location_id <> p.target_location_id OR sd.stock_status <> p.stock_status
    OR sd.serial_id IS NOT NULL OR sd.inventory_owner_id IS DISTINCT FROM p.inventory_owner_id)
    FILTER(WHERE sl.id IS NOT NULL),false) AS invalid
  FROM origins p
  LEFT JOIN public.stock_dimensions sd ON sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id
  LEFT JOIN public.stock_ledger sl ON sl.tenant_id=p_tenant AND sl.stock_dimension_id=sd.id
  GROUP BY p.id
 ), ledger_by_origin_line AS MATERIALIZED (
  SELECT p.id,bool_or(sd.handling_unit_id IS DISTINCT FROM p.id) AS invalid
  FROM origins p
  JOIN public.stock_ledger sl ON sl.tenant_id=p_tenant AND sl.document_id=d.id AND sl.document_line_id=p.document_line_id
  JOIN public.stock_dimensions sd ON sd.tenant_id=p_tenant AND sd.id=sl.stock_dimension_id
  GROUP BY p.id
 ), balance_by_package AS MATERIALIZED (
  SELECT p.id,coalesce(sum(b.quantity),0) AS total,
   count(DISTINCT sd.location_id) FILTER(WHERE b.quantity>0) AS positive_locations,
   coalesce(bool_or(b.quantity>0 AND (sd.item_id<>p.item_id OR sd.lot_id IS DISTINCT FROM p.lot_id))
    FILTER(WHERE b.stock_dimension_id IS NOT NULL),false) AS invalid
  FROM origins p
  LEFT JOIN public.stock_dimensions sd ON sd.tenant_id=p_tenant AND sd.handling_unit_id=p.id
  LEFT JOIN public.stock_balances b ON b.tenant_id=p_tenant AND b.stock_dimension_id=sd.id
  GROUP BY p.id
 )
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
  coalesce(bool_or(lo.invalid),false) AS ledger_dimension_invalid,
  coalesce(bool_or(lp.invalid),false) AS ledger_origin_invalid,
  coalesce(bool_or(lp.total <> (CASE WHEN d.status='POSTED' THEN p.base_quantity ELSE 0 END)),false) AS ledger_quantity_invalid,
  coalesce(bool_or(bp.total>p.base_quantity OR bp.positive_locations>1 OR (d.status <> 'POSTED' AND bp.total<>0) OR bp.invalid),false) AS balance_origin_invalid
 INTO checks
 FROM origins p
 JOIN ledger_by_package lp ON lp.id=p.id
 LEFT JOIN ledger_by_origin_line lo ON lo.id=p.id
 JOIN balance_by_package bp ON bp.id=p.id;
 -- Deterministic category priority replaces unspecified package iteration order;
 -- single-fault categories and their predicates are unchanged.
 IF checks.origin_line_invalid THEN RAISE EXCEPTION 'PACKAGE_ORIGIN_LINE' USING ERRCODE='23514'; END IF;
 IF checks.counters_invalid THEN RAISE EXCEPTION 'PACKAGE_RECEIPT_COUNTERS' USING ERRCODE='23514'; END IF;
 IF checks.ledger_dimension_invalid THEN RAISE EXCEPTION 'PACKAGE_LEDGER_DIMENSION' USING ERRCODE='23514'; END IF;
 IF checks.ledger_origin_invalid THEN RAISE EXCEPTION 'PACKAGE_LEDGER_ORIGIN_ONLY' USING ERRCODE='23514'; END IF;
 IF checks.ledger_quantity_invalid THEN RAISE EXCEPTION 'PACKAGE_LEDGER_QUANTITY' USING ERRCODE='23514'; END IF;
 IF checks.balance_origin_invalid THEN RAISE EXCEPTION 'PACKAGE_BALANCE_ORIGIN' USING ERRCODE='23514'; END IF;
END; $fn$;
