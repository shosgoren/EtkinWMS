-- T960: immutable production genealogy; one source warehouse / one OUT, no implicit transfer.
ALTER TABLE public.handling_units ADD COLUMN package_production_id uuid,
 ADD CONSTRAINT handling_units_package_origin_exclusive CHECK(package_receipt_id IS NULL OR package_production_id IS NULL),
 ADD CONSTRAINT handling_units_package_production_key UNIQUE(tenant_id,id,package_production_id);
GRANT INSERT(package_production_id) ON public.handling_units TO wms_app;
CREATE TABLE public.production_batches (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id), id uuid NOT NULL DEFAULT gen_random_uuid(),
 recipe_id uuid NOT NULL,output_document_id uuid NOT NULL,
 target_location_id uuid NOT NULL,output_quantity numeric(20,6) NOT NULL CHECK(output_quantity>0),
 output_unit_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,output_document_id),
 FOREIGN KEY(tenant_id,recipe_id) REFERENCES public.production_recipes(tenant_id,id),
 FOREIGN KEY(tenant_id,output_document_id) REFERENCES public.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,target_location_id) REFERENCES public.locations(tenant_id,id),
 FOREIGN KEY(tenant_id,output_unit_id) REFERENCES public.units(tenant_id,id)
);
CREATE TABLE public.production_inputs (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),production_batch_id uuid NOT NULL,handling_unit_id uuid NOT NULL,
 previous_document_line_id uuid NOT NULL,sequence_no integer NOT NULL CHECK(sequence_no>0),
 current_balance_version bigint NOT NULL CHECK(current_balance_version>=0),base_quantity numeric(20,6) NOT NULL CHECK(base_quantity>0),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,production_batch_id,handling_unit_id),
 FOREIGN KEY(tenant_id,production_batch_id) REFERENCES public.production_batches(tenant_id,id),
 FOREIGN KEY(tenant_id,handling_unit_id) REFERENCES public.handling_units(tenant_id,id),
 FOREIGN KEY(tenant_id,previous_document_line_id) REFERENCES public.document_lines(tenant_id,id)
);
CREATE TABLE public.production_packages (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 production_batch_id uuid NOT NULL,document_id uuid NOT NULL,document_line_id uuid NOT NULL,
 package_no integer NOT NULL CHECK(package_no BETWEEN 1 AND 200),lot_code text,produced_on date,expires_on date,
 catalog_lot_id uuid,package_dates date[] GENERATED ALWAYS AS(ARRAY[produced_on,expires_on]) STORED NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,id),UNIQUE(tenant_id,id,production_batch_id),
 UNIQUE(tenant_id,document_line_id),UNIQUE(tenant_id,production_batch_id,package_no),
 FOREIGN KEY(tenant_id,production_batch_id) REFERENCES public.production_batches(tenant_id,id),
 FOREIGN KEY(tenant_id,id,production_batch_id) REFERENCES public.handling_units(tenant_id,id,package_production_id),
 FOREIGN KEY(tenant_id,document_id,document_line_id) REFERENCES public.document_lines(tenant_id,document_id,id),
 FOREIGN KEY(tenant_id,catalog_lot_id,lot_code,package_dates) REFERENCES public.lots(tenant_id,id,lot_code,package_dates),
 CHECK(catalog_lot_id IS NULL OR lot_code IS NOT NULL),CHECK(lot_code IS NULL OR btrim(lot_code)<>''),
 CHECK(produced_on IS NULL OR expires_on IS NULL OR expires_on>=produced_on)
);
ALTER TABLE public.handling_units ADD CONSTRAINT handling_units_production_pair_fkey
 FOREIGN KEY(tenant_id,id,package_production_id) REFERENCES public.production_packages(tenant_id,id,production_batch_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX production_packages_batch_idx ON public.production_packages(tenant_id,production_batch_id);
DO $rls$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['production_batches','production_packages','production_inputs'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format($policy$CREATE POLICY isolation ON public.%I USING(tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)$policy$,tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tab);
  EXECUTE format('GRANT SELECT ON public.%I TO wms_app',tab);
 END LOOP;
END; $rls$;
GRANT INSERT(tenant_id,id,recipe_id,output_document_id,target_location_id,output_quantity) ON public.production_batches TO wms_app;
GRANT INSERT(tenant_id,production_batch_id,handling_unit_id,previous_document_line_id,sequence_no,current_balance_version,base_quantity) ON public.production_inputs TO wms_app;
GRANT INSERT(tenant_id,id,production_batch_id,document_id,document_line_id,package_no,lot_code,produced_on,expires_on,catalog_lot_id) ON public.production_packages TO wms_app;
ALTER TABLE public.package_movement_steps DROP CONSTRAINT package_movement_steps_tenant_id_handling_unit_id_fkey,
 DROP CONSTRAINT package_movement_steps_tenant_id_document_id_key,
 DROP CONSTRAINT package_movement_steps_operation_check,
 ADD COLUMN production_batch_id uuid,
 ADD CONSTRAINT package_movement_steps_hu_fkey FOREIGN KEY(tenant_id,handling_unit_id) REFERENCES public.handling_units(tenant_id,id),
 ADD CONSTRAINT package_movement_steps_batch_fkey FOREIGN KEY(tenant_id,production_batch_id) REFERENCES public.production_batches(tenant_id,id),
 ADD CONSTRAINT package_movement_steps_operation_check CHECK(operation IN ('QC_RELEASE','PUTAWAY','WAREHOUSE_TRANSFER','CONSUME')),
 ADD CONSTRAINT package_movement_steps_consume_batch_check CHECK((operation='CONSUME')=(production_batch_id IS NOT NULL));
GRANT INSERT(production_batch_id) ON public.package_movement_steps TO wms_app;
CREATE FUNCTION public.package_origin(p_tenant uuid,p_package uuid) RETURNS TABLE(
 tenant_id uuid,id uuid,document_id uuid,document_line_id uuid,warehouse_id uuid,item_id uuid,unit_id uuid,
 quantity numeric,conversion_factor numeric,base_quantity numeric,lot_id uuid,inventory_owner_id uuid,
 target_location_id uuid,stock_status text,document_status text,reversed_quantity numeric,reversal_status text,
 lot_code text,produced_on date,expires_on date,origin_kind text,production_batch_id uuid,receipt_id uuid)
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $fn$
 SELECT rp.tenant_id,rp.id,l.document_id,l.id,d.warehouse_id,l.item_id,l.unit_id,l.quantity,l.conversion_factor,l.base_quantity,
 l.lot_id,l.inventory_owner_id,l.target_location_id,l.stock_status,d.status,l.reversed_quantity,l.reversal_status,
 rp.lot_code,rp.produced_on,rp.expires_on,'RECEIPT'::text,NULL::uuid,rp.receipt_id
 FROM public.receipt_packages rp JOIN public.document_lines l ON l.tenant_id=rp.tenant_id AND l.id=rp.document_line_id
 JOIN public.documents d ON d.tenant_id=l.tenant_id AND d.id=l.document_id WHERE rp.tenant_id=p_tenant AND rp.id=p_package
 UNION ALL
 SELECT pp.tenant_id,pp.id,l.document_id,l.id,d.warehouse_id,l.item_id,l.unit_id,l.quantity,l.conversion_factor,l.base_quantity,
 l.lot_id,l.inventory_owner_id,l.target_location_id,l.stock_status,d.status,l.reversed_quantity,l.reversal_status,
 pp.lot_code,pp.produced_on,pp.expires_on,'PRODUCTION'::text,pp.production_batch_id,NULL::uuid
 FROM public.production_packages pp JOIN public.document_lines l ON l.tenant_id=pp.tenant_id AND l.id=pp.document_line_id
 JOIN public.documents d ON d.tenant_id=l.tenant_id AND d.id=l.document_id WHERE pp.tenant_id=p_tenant AND pp.id=p_package;
$fn$;
REVOKE ALL ON FUNCTION public.package_origin(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_origin(uuid,uuid) TO wms_app;

CREATE OR REPLACE FUNCTION public.package_movement_assert(p_tenant uuid,p_package uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE origin record; step record; expected_line uuid; expected_location uuid; expected_status text; expected_seq integer:=1; expected_warehouse uuid;
 n integer; effects integer; out_effects integer; in_effects integer; positive_count integer; total numeric; expected_remaining numeric;
BEGIN
 IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN
  RAISE EXCEPTION 'PACKAGE_TENANT_CONTEXT_MISMATCH' USING ERRCODE='23514';
 END IF;
 SELECT * INTO origin FROM public.package_origin(p_tenant,p_package);
 IF NOT FOUND OR origin.document_status <> 'POSTED' OR origin.reversed_quantity<>0 OR origin.reversal_status<>'NONE' THEN
  RAISE EXCEPTION 'PACKAGE_MOVEMENT_ORIGIN' USING ERRCODE='23514';
 END IF;
 expected_remaining:=origin.base_quantity; expected_warehouse:=origin.warehouse_id; expected_line:=origin.document_line_id; expected_location:=origin.target_location_id; expected_status:=origin.stock_status;
 FOR step IN SELECT * FROM public.package_movement_steps WHERE tenant_id=p_tenant AND handling_unit_id=p_package ORDER BY sequence_no LOOP
  IF step.sequence_no<>expected_seq OR step.previous_document_line_id<>expected_line
   OR step.source_location_id<>expected_location OR step.source_stock_status<>expected_status
   OR (step.operation<>'CONSUME' AND step.base_quantity<>expected_remaining)
   OR (step.operation='CONSUME' AND (step.base_quantity>expected_remaining OR expected_status<>'AVAILABLE')) THEN
   RAISE EXCEPTION 'PACKAGE_MOVEMENT_CHAIN' USING ERRCODE='23514';
  END IF;
  IF step.operation='CONSUME' THEN
   SELECT count(*) INTO n FROM public.documents d JOIN public.document_lines l ON l.tenant_id=d.tenant_id AND l.document_id=d.id
   JOIN public.production_batches batch ON batch.tenant_id=d.tenant_id AND batch.id=step.production_batch_id
   JOIN public.stock_document_links link ON link.tenant_id=batch.tenant_id AND link.target_document_id=batch.output_document_id
    AND link.source_document_id=d.id AND link.kind='PRODUCTION' AND link.recipe_id=batch.recipe_id
   JOIN public.locations loc ON loc.tenant_id=l.tenant_id AND loc.id=l.source_location_id
   WHERE d.tenant_id=p_tenant AND d.id=step.document_id AND l.id=step.document_line_id
    AND d.kind='STOCK_OUT' AND d.status='POSTED' AND d.warehouse_id=expected_warehouse AND loc.warehouse_id=expected_warehouse
    AND d.source_kind IS NULL AND d.source_id IS NULL AND d.reversal_of_document_id IS NULL
    AND l.handling_unit_id=p_package AND l.item_id=origin.item_id AND l.lot_id IS NOT DISTINCT FROM origin.lot_id
    AND l.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id AND l.serial_id IS NULL
    AND l.unit_id=origin.unit_id AND l.conversion_factor=origin.conversion_factor AND l.base_quantity=step.base_quantity
    AND l.base_quantity=l.quantity*l.conversion_factor AND l.reversed_quantity=0 AND l.reversal_status='NONE' AND l.source_line_id IS NULL
    AND l.source_location_id=step.source_location_id AND l.target_location_id IS NULL
    AND step.target_location_id=step.source_location_id AND step.source_stock_status='AVAILABLE' AND step.target_stock_status='AVAILABLE'
    AND l.stock_status='AVAILABLE' AND coalesce(l.target_stock_status,l.stock_status)='AVAILABLE';
   IF n<>1 THEN RAISE EXCEPTION 'PACKAGE_CONSUME_LINE' USING ERRCODE='23514'; END IF;
   SELECT count(*) INTO n FROM public.stock_ledger sl JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id
   WHERE sl.tenant_id=p_tenant AND sl.document_id=step.document_id AND sl.document_line_id=step.document_line_id
    AND sl.quantity=-step.base_quantity AND sd.handling_unit_id=p_package AND sd.item_id=origin.item_id
    AND sd.lot_id IS NOT DISTINCT FROM origin.lot_id AND sd.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id
    AND sd.serial_id IS NULL AND sd.location_id=expected_location AND sd.stock_status='AVAILABLE';
   IF n<>1 OR (SELECT count(*) FROM public.stock_ledger WHERE tenant_id=p_tenant AND document_id=step.document_id AND document_line_id=step.document_line_id)<>1 THEN
    RAISE EXCEPTION 'PACKAGE_CONSUME_LEDGER' USING ERRCODE='23514';
   END IF;
   expected_remaining:=expected_remaining-step.base_quantity;
  ELSIF step.operation='WAREHOUSE_TRANSFER' THEN
   -- Legacy0029 permits several target links; a registered package transfer has one canonical pair.
   IF (SELECT count(*) FROM public.stock_document_links WHERE tenant_id=p_tenant AND target_document_id=step.document_id)<>1
   OR EXISTS(SELECT 1 FROM public.stock_document_links WHERE tenant_id=p_tenant AND target_document_id=step.document_id
    AND (kind<>'TRANSFER' OR source_document_id IS DISTINCT FROM step.source_document_id OR recipe_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'PACKAGE_TRANSFER_LINK' USING ERRCODE='23514';
   END IF;
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
    AND l.quantity*l.conversion_factor=expected_remaining AND out_line.quantity*out_line.conversion_factor=expected_remaining
    AND l.base_quantity=expected_remaining AND out_line.base_quantity=expected_remaining
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
   AND l.quantity*l.conversion_factor=expected_remaining AND l.base_quantity=expected_remaining
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
 IF EXISTS(SELECT 1 FROM public.stock_ledger sl JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id
  WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p_package AND NOT (
   (sl.document_id=origin.document_id AND sl.document_line_id=origin.document_line_id AND sl.quantity>0
    AND sd.item_id=origin.item_id AND sd.location_id=origin.target_location_id AND sd.stock_status=origin.stock_status
    AND sd.lot_id IS NOT DISTINCT FROM origin.lot_id AND sd.inventory_owner_id IS NOT DISTINCT FROM origin.inventory_owner_id AND sd.serial_id IS NULL)
   OR EXISTS(SELECT 1 FROM public.package_movement_steps ms WHERE ms.tenant_id=p_tenant AND ms.handling_unit_id=p_package
    AND ((ms.document_id=sl.document_id AND ms.document_line_id=sl.document_line_id)
     OR (ms.source_document_id=sl.document_id AND ms.source_document_line_id=sl.document_line_id)))
  )) THEN RAISE EXCEPTION 'PACKAGE_LEDGER_ORIGIN_ONLY' USING ERRCODE='23514'; END IF;
 SELECT count(*) FILTER(WHERE b.quantity>0),coalesce(sum(b.quantity),0) INTO positive_count,total
 FROM public.stock_dimensions sd JOIN public.stock_balances b ON b.tenant_id=sd.tenant_id AND b.stock_dimension_id=sd.id
 WHERE sd.tenant_id=p_tenant AND sd.handling_unit_id=p_package;
 IF positive_count<>(CASE WHEN expected_remaining>0 THEN 1 ELSE 0 END) OR total<>expected_remaining OR EXISTS(
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
  coalesce((SELECT bool_or(lp.total <> (CASE WHEN d.status='POSTED' THEN lp.base_quantity-coalesce((SELECT sum(ms.base_quantity) FROM public.package_movement_steps ms WHERE ms.tenant_id=p_tenant AND ms.handling_unit_id=lp.id AND ms.operation='CONSUME'),0) ELSE 0 END)) FROM ledger_by_package lp),false) AS ledger_quantity_invalid,
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
  FOR package_id IN SELECT handling_unit_id FROM public.package_movement_steps WHERE tenant_id=NEW.tenant_id AND (document_id=NEW.id OR source_document_id=NEW.id) LOOP
   PERFORM public.package_movement_assert(NEW.tenant_id,package_id);
  END LOOP;
  RETURN NULL;
 END IF;
 IF package_id IS NOT NULL THEN PERFORM public.package_movement_assert(NEW.tenant_id,package_id); END IF;
 RETURN NULL;
END; $fn$;
CREATE OR REPLACE FUNCTION public.handling_units_package_marker_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 IF NEW.package_production_id IS DISTINCT FROM OLD.package_production_id OR NEW.package_receipt_id IS DISTINCT FROM OLD.package_receipt_id THEN
  RAISE EXCEPTION 'PACKAGE_HU_BINDING_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $fn$;
CREATE FUNCTION public.package_production_assert(p_tenant uuid,p_batch uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE b record;r record;into_doc record;out_doc record;n integer;pkg uuid;source_doc uuid;posted boolean;
BEGIN
 IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'PACKAGE_TENANT_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM public.production_batches WHERE tenant_id=p_tenant AND id=p_batch;
 IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_PRODUCTION_BATCH' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM public.production_recipes WHERE tenant_id=p_tenant AND id=b.recipe_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_PRODUCTION_RECIPE' USING ERRCODE='23514'; END IF;
 SELECT * INTO into_doc FROM public.documents WHERE tenant_id=p_tenant AND id=b.output_document_id;
 IF NOT FOUND OR into_doc.kind<>'STOCK_IN' OR into_doc.status NOT IN ('DRAFT','APPROVED','POSTED') OR into_doc.source_kind IS NOT NULL OR into_doc.source_id IS NOT NULL
 OR into_doc.reversal_of_document_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.locations WHERE tenant_id=p_tenant AND id=b.target_location_id AND warehouse_id=into_doc.warehouse_id AND kind IN ('RECEIVING','STORAGE')) THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_DOCUMENTS' USING ERRCODE='23514';
 END IF;
 posted:=into_doc.status='POSTED';
 SELECT count(*) INTO n FROM public.production_packages WHERE tenant_id=p_tenant AND production_batch_id=p_batch;
 IF n NOT BETWEEN 1 AND 200 OR n<>(SELECT count(*) FROM public.document_lines WHERE tenant_id=p_tenant AND document_id=b.output_document_id)
 OR (SELECT coalesce(sum(base_quantity),0) FROM public.document_lines WHERE tenant_id=p_tenant AND document_id=b.output_document_id)<>b.output_quantity THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_OUTPUT_COVERAGE' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.production_packages pp JOIN public.document_lines l ON l.tenant_id=pp.tenant_id AND l.id=pp.document_line_id
  WHERE pp.tenant_id=p_tenant AND pp.production_batch_id=p_batch AND (pp.document_id<>b.output_document_id OR l.document_id<>b.output_document_id
   OR l.item_id<>r.output_item_id OR l.unit_id<>b.output_unit_id OR l.conversion_factor<>1 OR l.quantity<>l.base_quantity OR l.quantity<=0
   OR l.handling_unit_id IS DISTINCT FROM pp.id OR l.target_location_id IS DISTINCT FROM b.target_location_id OR l.source_location_id IS NOT NULL
   OR l.stock_status<>'AVAILABLE' OR l.target_stock_status IS NOT NULL OR l.serial_id IS NOT NULL OR l.source_line_id IS NOT NULL
   OR l.reversed_quantity<>0 OR l.reversal_status<>'NONE' OR l.inventory_owner_id IS NOT NULL OR l.lot_id IS DISTINCT FROM pp.catalog_lot_id)) THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_OUTPUT' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO n FROM public.production_inputs WHERE tenant_id=p_tenant AND production_batch_id=p_batch;
 IF n NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'PACKAGE_PRODUCTION_INPUT_COVERAGE' USING ERRCODE='23514'; END IF;
 IF EXISTS(WITH allocations AS (
  SELECT o.item_id,sum(i.base_quantity) AS quantity FROM public.production_inputs i
  LEFT JOIN LATERAL public.package_origin(i.tenant_id,i.handling_unit_id) o ON true
  WHERE i.tenant_id=p_tenant AND i.production_batch_id=p_batch GROUP BY o.item_id
 ),components AS (SELECT item_id,quantity FROM public.production_recipe_lines WHERE tenant_id=p_tenant AND recipe_id=b.recipe_id)
 SELECT 1 FROM allocations a FULL JOIN components c ON c.item_id=a.item_id
 WHERE a.item_id IS NULL OR c.item_id IS NULL OR a.quantity*r.output_quantity<>c.quantity*b.output_quantity) THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_COMPONENTS' USING ERRCODE='23514';
 END IF;
 IF NOT posted THEN
  IF EXISTS(SELECT 1 FROM public.stock_document_links WHERE tenant_id=p_tenant AND target_document_id=b.output_document_id)
  OR EXISTS(SELECT 1 FROM public.package_movement_steps WHERE tenant_id=p_tenant AND production_batch_id=p_batch)
  OR EXISTS(SELECT 1 FROM public.stock_ledger WHERE tenant_id=p_tenant AND document_id=b.output_document_id)
  OR EXISTS(SELECT 1 FROM public.stock_dimensions sd JOIN public.production_packages pp ON pp.tenant_id=sd.tenant_id AND pp.id=sd.handling_unit_id
   LEFT JOIN public.stock_balances bal ON bal.tenant_id=sd.tenant_id AND bal.stock_dimension_id=sd.id
   WHERE pp.tenant_id=p_tenant AND pp.production_batch_id=p_batch AND (coalesce(bal.quantity,0)<>0 OR coalesce(bal.reserved_quantity,0)<>0
    OR EXISTS(SELECT 1 FROM public.stock_ledger WHERE tenant_id=p_tenant AND stock_dimension_id=sd.id))) THEN
   RAISE EXCEPTION 'PACKAGE_PRODUCTION_PENDING_STOCK' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.production_inputs i LEFT JOIN LATERAL public.package_origin(i.tenant_id,i.handling_unit_id) o ON true
   LEFT JOIN LATERAL(SELECT * FROM public.package_movement_steps WHERE tenant_id=p_tenant AND handling_unit_id=i.handling_unit_id ORDER BY sequence_no DESC LIMIT 1) last_step ON true
   LEFT JOIN public.stock_dimensions sd ON sd.tenant_id=i.tenant_id AND sd.handling_unit_id=i.handling_unit_id AND sd.location_id=coalesce(last_step.target_location_id,o.target_location_id)
    AND sd.stock_status='AVAILABLE'
   LEFT JOIN public.stock_balances bal ON bal.tenant_id=sd.tenant_id AND bal.stock_dimension_id=sd.id AND bal.quantity>0
   WHERE i.tenant_id=p_tenant AND i.production_batch_id=p_batch AND (o.id IS NULL OR o.document_status<>'POSTED'
    OR coalesce(last_step.target_stock_status,o.stock_status)<>'AVAILABLE' OR i.previous_document_line_id<>coalesce(last_step.document_line_id,o.document_line_id)
    OR i.sequence_no<>coalesce(last_step.sequence_no,0)+1 OR bal.stock_dimension_id IS NULL OR bal.version<>i.current_balance_version OR bal.quantity-bal.reserved_quantity<i.base_quantity)) THEN
   RAISE EXCEPTION 'PACKAGE_PRODUCTION_PENDING_INPUT' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(DISTINCT loc.warehouse_id) FROM public.production_inputs i
   JOIN public.stock_dimensions sd ON sd.tenant_id=i.tenant_id AND sd.handling_unit_id=i.handling_unit_id
   JOIN public.stock_balances bal ON bal.tenant_id=sd.tenant_id AND bal.stock_dimension_id=sd.id AND bal.quantity>0
   JOIN public.locations loc ON loc.tenant_id=sd.tenant_id AND loc.id=sd.location_id
   WHERE i.tenant_id=p_tenant AND i.production_batch_id=p_batch)<>1 THEN
   RAISE EXCEPTION 'PACKAGE_PRODUCTION_SOURCE_WAREHOUSE' USING ERRCODE='23514';
  END IF;
  RETURN;
 END IF;
 -- 0029 permits multiple target links for legacy production. Registered package batches do not:
 -- count every target link before filtering so foreign recipes/kinds cannot hide an extra source.
 IF (SELECT count(*) FROM public.stock_document_links WHERE tenant_id=p_tenant AND target_document_id=b.output_document_id)<>1
 OR EXISTS(SELECT 1 FROM public.stock_document_links WHERE tenant_id=p_tenant AND target_document_id=b.output_document_id
  AND (kind<>'PRODUCTION' OR recipe_id IS DISTINCT FROM b.recipe_id)) THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_LINK' USING ERRCODE='23514';
 END IF;
 SELECT source_document_id INTO source_doc FROM public.stock_document_links WHERE tenant_id=p_tenant AND target_document_id=b.output_document_id;
 SELECT * INTO out_doc FROM public.documents WHERE tenant_id=p_tenant AND id=source_doc;
 IF NOT FOUND OR out_doc.kind<>'STOCK_OUT' OR out_doc.status<>'POSTED' OR out_doc.source_kind IS NOT NULL OR out_doc.source_id IS NOT NULL OR out_doc.reversal_of_document_id IS NOT NULL THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_DOCUMENTS' USING ERRCODE='23514';
 END IF;
 IF n<>(SELECT count(*) FROM public.package_movement_steps WHERE tenant_id=p_tenant AND production_batch_id=p_batch AND operation='CONSUME')
 OR n<>(SELECT count(*) FROM public.document_lines WHERE tenant_id=p_tenant AND document_id=source_doc)
 OR n<>(SELECT count(*) FROM public.stock_ledger WHERE tenant_id=p_tenant AND document_id=source_doc)
 OR EXISTS(SELECT 1 FROM public.production_inputs i LEFT JOIN public.package_movement_steps ms ON ms.tenant_id=i.tenant_id AND ms.production_batch_id=i.production_batch_id AND ms.handling_unit_id=i.handling_unit_id
  WHERE i.tenant_id=p_tenant AND i.production_batch_id=p_batch AND (ms.document_line_id IS NULL OR ms.operation<>'CONSUME' OR ms.document_id<>source_doc
   OR ms.previous_document_line_id<>i.previous_document_line_id OR ms.sequence_no<>i.sequence_no OR ms.base_quantity<>i.base_quantity)) THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_INPUT_COVERAGE' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.production_packages pp JOIN public.document_lines l ON l.tenant_id=pp.tenant_id AND l.id=pp.document_line_id
  WHERE pp.tenant_id=p_tenant AND pp.production_batch_id=p_batch AND
   (SELECT count(*) FROM public.stock_ledger sl JOIN public.stock_dimensions sd ON sd.tenant_id=sl.tenant_id AND sd.id=sl.stock_dimension_id
    WHERE sl.tenant_id=p_tenant AND sl.document_id=b.output_document_id AND sl.document_line_id=l.id AND sl.quantity=l.base_quantity
     AND sd.handling_unit_id=pp.id AND sd.item_id=l.item_id AND sd.location_id=l.target_location_id AND sd.stock_status='AVAILABLE'
     AND sd.lot_id IS NOT DISTINCT FROM l.lot_id AND sd.inventory_owner_id IS NULL AND sd.serial_id IS NULL)<>1)
 OR (SELECT count(*) FROM public.stock_ledger WHERE tenant_id=p_tenant AND document_id=b.output_document_id)<>(SELECT count(*) FROM public.production_packages WHERE tenant_id=p_tenant AND production_batch_id=p_batch) THEN
  RAISE EXCEPTION 'PACKAGE_PRODUCTION_OUTPUT' USING ERRCODE='23514';
 END IF;
 IF EXISTS(WITH RECURSIVE ancestry(id,path,cycle) AS (
  SELECT pp.production_batch_id,ARRAY[p_batch,pp.production_batch_id],pp.production_batch_id=p_batch FROM public.production_inputs i
  JOIN public.production_packages pp ON pp.tenant_id=i.tenant_id AND pp.id=i.handling_unit_id WHERE i.tenant_id=p_tenant AND i.production_batch_id=p_batch
  UNION ALL SELECT pp.production_batch_id,a.path||pp.production_batch_id,pp.production_batch_id=ANY(a.path)
  FROM ancestry a JOIN public.production_inputs i ON i.tenant_id=p_tenant AND i.production_batch_id=a.id
  JOIN public.production_packages pp ON pp.tenant_id=i.tenant_id AND pp.id=i.handling_unit_id WHERE NOT a.cycle
 ) SELECT 1 FROM ancestry WHERE cycle) THEN RAISE EXCEPTION 'PACKAGE_PRODUCTION_CYCLE' USING ERRCODE='23514'; END IF;
 FOR pkg IN SELECT id FROM public.production_packages WHERE tenant_id=p_tenant AND production_batch_id=p_batch
  UNION SELECT handling_unit_id FROM public.production_inputs WHERE tenant_id=p_tenant AND production_batch_id=p_batch LOOP
  PERFORM public.package_movement_assert(p_tenant,pkg);
 END LOOP;
END; $fn$;
REVOKE ALL ON FUNCTION public.package_production_assert(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_production_assert(uuid,uuid) TO wms_app;
CREATE FUNCTION public.package_production_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE linked boolean;
BEGIN
 IF TG_TABLE_NAME IN ('production_batches','production_packages','production_inputs') THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PACKAGE_PRODUCTION_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM NULLIF(current_setting('app.current_tenant_id',true),'')::uuid THEN
   -- Runtime foreign INSERT belongs to native FORCE RLS WITH CHECK, before parent lookups.
   -- The application role is NOSUPERUSER/NOBYPASSRLS; privileged callbacks still fail closed.
   IF current_user='wms_app' THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'PACKAGE_TENANT_CONTEXT_MISMATCH' USING ERRCODE='42501';
  END IF;
  NEW.created_at:=now();
  IF TG_TABLE_NAME='production_batches' THEN
   SELECT i.base_unit_id INTO NEW.output_unit_id FROM public.production_recipes r JOIN public.items i ON i.tenant_id=r.tenant_id AND i.id=r.output_item_id
    WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.recipe_id;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='documents' THEN
  SELECT EXISTS(SELECT 1 FROM public.production_batches WHERE tenant_id=OLD.tenant_id AND (output_document_id=OLD.id OR EXISTS(SELECT 1 FROM public.stock_document_links WHERE tenant_id=OLD.tenant_id AND target_document_id=output_document_id AND source_document_id=OLD.id))) INTO linked;
  IF linked AND (TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','version','number','posted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','number','posted_at'])) THEN
   RAISE EXCEPTION 'PACKAGE_PRODUCTION_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='document_lines' THEN
  SELECT EXISTS(SELECT 1 FROM public.production_packages WHERE tenant_id=OLD.tenant_id AND document_line_id=OLD.id) INTO linked;
  IF linked AND (TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN RAISE EXCEPTION 'PACKAGE_PRODUCTION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $fn$;
REVOKE ALL ON FUNCTION public.package_production_guard() FROM PUBLIC;
CREATE TRIGGER production_batches_guard BEFORE INSERT OR UPDATE OR DELETE ON public.production_batches FOR EACH ROW EXECUTE FUNCTION public.package_production_guard();
CREATE TRIGGER production_inputs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.production_inputs FOR EACH ROW EXECUTE FUNCTION public.package_production_guard();
CREATE TRIGGER production_inputs_no_truncate BEFORE TRUNCATE ON public.production_inputs FOR EACH STATEMENT EXECUTE FUNCTION public.package_production_guard();
CREATE TRIGGER production_packages_guard BEFORE INSERT OR UPDATE OR DELETE ON public.production_packages FOR EACH ROW EXECUTE FUNCTION public.package_production_guard();
CREATE TRIGGER production_batches_no_truncate BEFORE TRUNCATE ON public.production_batches FOR EACH STATEMENT EXECUTE FUNCTION public.package_production_guard();
CREATE TRIGGER production_packages_no_truncate BEFORE TRUNCATE ON public.production_packages FOR EACH STATEMENT EXECUTE FUNCTION public.package_production_guard();
CREATE TRIGGER production_package_documents_guard BEFORE UPDATE OR DELETE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.package_production_guard();
CREATE TRIGGER production_package_lines_guard BEFORE UPDATE OR DELETE ON public.document_lines FOR EACH ROW EXECUTE FUNCTION public.package_production_guard();
CREATE FUNCTION public.package_production_check() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE batch uuid;dim uuid;doc uuid;
BEGIN
 IF TG_TABLE_NAME='production_batches' THEN PERFORM public.package_production_assert(NEW.tenant_id,NEW.id);
 ELSIF TG_TABLE_NAME IN ('production_packages','production_inputs') THEN PERFORM public.package_production_assert(NEW.tenant_id,NEW.production_batch_id);
 ELSIF TG_TABLE_NAME='package_movement_steps' THEN
  IF NEW.production_batch_id IS NOT NULL THEN PERFORM public.package_production_assert(NEW.tenant_id,NEW.production_batch_id); END IF;
 ELSIF TG_TABLE_NAME IN ('documents','document_lines','stock_ledger','stock_document_links') THEN
  doc:=CASE WHEN TG_TABLE_NAME='documents' THEN (to_jsonb(NEW)->>'id')::uuid WHEN TG_TABLE_NAME='stock_document_links' THEN (to_jsonb(NEW)->>'target_document_id')::uuid ELSE (to_jsonb(NEW)->>'document_id')::uuid END;
  FOR batch IN SELECT id FROM public.production_batches WHERE tenant_id=NEW.tenant_id AND (output_document_id=doc OR EXISTS(SELECT 1 FROM public.stock_document_links WHERE tenant_id=NEW.tenant_id AND target_document_id=output_document_id AND source_document_id=doc)) LOOP
   PERFORM public.package_production_assert(NEW.tenant_id,batch);
  END LOOP;
 END IF;
 IF TG_TABLE_NAME IN ('stock_ledger','stock_balances') THEN
  dim:=NEW.stock_dimension_id;
  FOR batch IN SELECT pp.production_batch_id FROM public.stock_dimensions sd JOIN public.production_packages pp ON pp.tenant_id=sd.tenant_id AND pp.id=sd.handling_unit_id
   WHERE sd.tenant_id=NEW.tenant_id AND sd.id=dim LOOP
   PERFORM public.package_production_assert(NEW.tenant_id,batch);
  END LOOP;
 END IF;
 RETURN NULL;
END; $fn$;
REVOKE ALL ON FUNCTION public.package_production_check() FROM PUBLIC;
DO $triggers$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['production_batches','production_packages','production_inputs','package_movement_steps','documents','document_lines','stock_ledger','stock_balances','stock_document_links'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER package_production_consistency AFTER INSERT OR UPDATE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.package_production_check()',tab);
 END LOOP;
END; $triggers$;

CREATE OR REPLACE FUNCTION public.package_transfer_link_guard() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 IF TG_OP='TRUNCATE' THEN
  RAISE EXCEPTION 'PACKAGE_TRANSFER_LINK_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.production_batches WHERE tenant_id=OLD.tenant_id AND (output_document_id=OLD.target_document_id)) OR EXISTS(SELECT 1 FROM public.package_movement_steps WHERE tenant_id=OLD.tenant_id
  AND operation='WAREHOUSE_TRANSFER' AND (source_document_id=OLD.source_document_id OR document_id=OLD.target_document_id)) THEN
  RAISE EXCEPTION 'PACKAGE_TRANSFER_LINK_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $fn$;
