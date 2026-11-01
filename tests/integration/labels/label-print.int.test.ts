// katman: db — scratch database; label metadata must never change stock or package identity.
import{randomUUID}from'node:crypto';
import{afterAll,beforeAll,expect,it}from'vitest';
import{readyLabelDesign,type LabelContext}from'../../../packages/shared/src/labels/index.ts';
import{saveLabelTemplate,publishLabelTemplate}from'../../../packages/domain/src/labels/store.ts';
import{saveLabelPrinter,setLabelPrinterPreference}from'../../../packages/domain/src/labels/printer-store.ts';
import{previewCustomLabels,prepareCustomLabels,readPreparedLabels,getLabelPrintChoices}from'../../../packages/domain/src/labels/print.ts';
import{preparePackageReceipt,postPackageReceipt,getPackageReceipt,getCurrentPackage,approvePackageQuality,putawayPackage,createProductionRecipe,preparePackageProduction,postPackageProduction,getPackageProductionBatch}from'../../../packages/domain/src/operations/index.ts';
import{createStockDocument,approveDocument,postDocument}from'../../../packages/domain/src/stock/index.ts';
import{labelServiceWorld}from'./service-fixture.ts';
let w:Awaited<ReturnType<typeof labelServiceWorld>>,receipt:string,packageIds:string[],receiving:string,item:string,product:string,receiptTemplate:string;
const call=()=>w.call(),stock=()=>({...call(),clientKey:randomUUID(),retry:{sleep:async()=>undefined}});
const productSource=()=>({kind:'PRODUCT' as const,ids:[product]});
async function publish(context:LabelContext,assign=false){const t=await saveLabelTemplate(call(),{expectedVersion:0,name:context+' '+randomUUID(),design:readyLabelDesign(context)});const r=await publishLabelTemplate(call(),{id:t.id,expectedVersion:t.version,...(assign?{expectedDefaultVersion:0}:{})});return{...r,id:t.id};}
async function unchangedStock(){return(await w.adm.query(`SELECT jsonb_build_object('ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.stock_ledger x WHERE tenant_id=$1),'balances',(SELECT jsonb_agg(to_jsonb(x) ORDER BY stock_dimension_id) FROM public.stock_balances x WHERE tenant_id=$1),'packages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.receipt_packages x WHERE tenant_id=$1),'serials',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.serials x WHERE tenant_id=$1),'hu',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.handling_units x WHERE tenant_id=$1)) AS value`,[w.A.tenantId])).rows[0]!.value;}
const jobs=async()=>Number((await w.adm.query('SELECT count(*) AS n FROM public.label_print_jobs WHERE tenant_id=$1',[w.A.tenantId])).rows[0]!.n);
beforeAll(async()=>{
 w=await labelServiceWorld();receiving=randomUUID();item=randomUUID();product=w.A.itemNoneId;
 await w.adm.query("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,'RECEIVING','Mal kabul',0,'RECEIVING')",[w.A.tenantId,receiving,w.A.warehouseId]);
 await w.adm.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,'HM-001','SBR granül',$3,'LOT',3)",[w.A.tenantId,item,w.A.unitId]);
 await w.adm.query("INSERT INTO public.item_barcodes(tenant_id,item_id,barcode) VALUES($1,$2,'ETK-PRODUCT-ONE')",[w.A.tenantId,product]);
 const d=await preparePackageReceipt(stock(),{warehouseId:w.A.warehouseId,receivingLocationId:receiving,itemId:item,unitId:w.A.unitId,kind:'VARIL',packages:{mode:'equal',count:5,quantity:'200',lotCode:'LOT-ONE',producedOn:'2026-10-01',expiresOn:'2027-10-01'}});
 receipt=d.documentId as string;await postPackageReceipt(stock(),{documentId:receipt,expectedVersion:1});
 const r=await getPackageReceipt(stock(),{documentId:receipt});packageIds=r.packages.map(p=>p.id);
 receiptTemplate=(await publish('RECEIPT',true)).id;await publish('PRODUCT',true);await publish('LOCATION',true);await publish('SHIPMENT',true);
},120000);
afterAll(async()=>{await w?.dispose();});
it('five barrels produce five existing unique QR snapshots with exact lot/dates/quantity and no stock effect',async()=>{
 const before=await unchangedStock(),n=await jobs(),source={kind:'RECEIPT',documentId:receipt};
 const preview=await previewCustomLabels(call(),{source,locale:'tr'},true);expect(preview.pages).toHaveLength(5);expect(new Set(preview.pages).size).toBe(5);expect(await jobs()).toBe(n);
 const made=await prepareCustomLabels(call(),{source,locale:'tr',jobId:randomUUID(),copies:1},true);expect(made.pages).toEqual(preview.pages);
 const saved=(await w.adm.query('SELECT snapshot FROM public.label_print_jobs WHERE tenant_id=$1 AND id=$2',[w.A.tenantId,made.jobId])).rows[0]!.snapshot;
 expect(saved.map((s:{values:{packageQr:string}})=>s.values.packageQr).sort()).toEqual(packageIds.map(id=>'EWMS:PKG:1:'+id).sort());
 expect(saved.every((s:{values:Record<string,string>})=>s.values.quantity==='200'&&s.values.lot==='LOT-ONE'&&s.values.productionDate==='01.10.2026'&&s.values.expiryDate==='01.10.2027')).toBe(true);
 expect(await unchangedStock()).toEqual(before);expect(await jobs()).toBe(n+1);
});
it('concurrent retries create one immutable job/audit; different content is rejected',async()=>{
 const input={source:productSource(),locale:'en' as const,jobId:randomUUID(),copies:2},n=await jobs();const[a,b]=await Promise.all([prepareCustomLabels(call(),input),prepareCustomLabels(call(),input)]);
 expect(a.jobId).toBe(b.jobId);expect(a.pages).toEqual(b.pages);expect([a.replayed,b.replayed].sort()).toEqual([false,true]);expect(await jobs()).toBe(n+1);
 expect(Number((await w.adm.query("SELECT count(*) AS n FROM public.audit_logs WHERE tenant_id=$1 AND action='label.print_prepared' AND entity_id=$2",[w.A.tenantId,a.jobId])).rows[0]!.n)).toBe(1);
 await expect(prepareCustomLabels(call(),{...input,copies:3})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
});
it('default uses its assigned version, explicit template uses latest published version',async()=>{
 const t=await publish('PRODUCT'),assigned=await publishLabelTemplate(call(),{id:t.id,expectedVersion:t.version,expectedDefaultVersion:1});
 const design=readyLabelDesign('PRODUCT'),changed={...design,elements:design.elements.map(e=>e.kind==='text'?{...e,bold:!e.bold}:e)};
 const draft=await saveLabelTemplate(call(),{id:t.id,expectedVersion:assigned.version,name:'New draft',design:changed});const latest=await publishLabelTemplate(call(),{id:t.id,expectedVersion:draft.version});
 const implicit=await previewCustomLabels(call(),{source:productSource(),locale:'en'}),explicit=await previewCustomLabels(call(),{source:productSource(),locale:'en',templateId:t.id});
 expect(implicit.versionId).toBe(assigned.publishedVersionId);expect(explicit.versionId).toBe(latest.publishedVersionId);expect(implicit.pages).not.toEqual(explicit.pages);
});
it('reprint retains original QR, values and immutable template even after source/template edits',async()=>{
 const original=await prepareCustomLabels(call(),{source:productSource(),locale:'en',jobId:randomUUID(),copies:1});
 await w.adm.query("UPDATE public.items SET name='Renamed item' WHERE tenant_id=$1 AND id=$2",[w.A.tenantId,product]);
 const current=await previewCustomLabels(call(),{source:productSource(),locale:'en'});expect(current.pages).not.toEqual(original.pages);
 const repeat=await prepareCustomLabels(call(),{source:original.source,locale:'en',jobId:randomUUID(),copies:1,reprintOf:original.jobId,reason:'Damaged label'});
 expect(repeat.pages).toEqual(original.pages);expect(repeat.versionId).toBe(original.versionId);expect(repeat.reprintOf).toBe(original.jobId);
 await expect(prepareCustomLabels(call(),{source:original.source,locale:'en',jobId:randomUUID(),copies:1,reprintOf:original.jobId})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 expect((await readPreparedLabels(call(),original.jobId)).pages).toEqual(original.pages);
});
it('template printer overrides general, actor device preference wins, disabled selection never falls back',async()=>{
 const spec={expectedVersion:0,name:'General',dpi:203 as const,offsetX:0,offsetY:0,active:true},general=await saveLabelPrinter(call(),spec),specific=await saveLabelPrinter(call(),{...spec,name:'Receipt',dpi:300}),devicePrinter=await saveLabelPrinter(call(),{...spec,name:'Handheld',dpi:600});
 await setLabelPrinterPreference(call(),{templateId:null,deviceId:null,printerId:general.id,expectedVersion:0});await setLabelPrinterPreference(call(),{templateId:receiptTemplate,deviceId:null,printerId:specific.id,expectedVersion:0});
 const source={kind:'RECEIPT',documentId:receipt};expect((await previewCustomLabels(call(),{source,locale:'tr'},true)).printer).toMatchObject({profileId:specific.id});
 const deviceId=randomUUID();await setLabelPrinterPreference(call(),{templateId:receiptTemplate,deviceId,printerId:devicePrinter.id,expectedVersion:0});expect((await previewCustomLabels(call(),{source,locale:'tr',deviceId},true)).printer).toMatchObject({profileId:devicePrinter.id});
 const old=await prepareCustomLabels(call(),{source,locale:'tr',deviceId,jobId:randomUUID(),copies:1},true);
 await saveLabelPrinter(call(),{...spec,id:devicePrinter.id,expectedVersion:1,name:'Handheld',dpi:600,active:false});
 await expect(previewCustomLabels(call(),{source,locale:'tr',deviceId},true)).rejects.toMatchObject({reason:'PRINTER_UNAVAILABLE'});
 expect((await readPreparedLabels(call(),old.jobId,false)).pages).toEqual(old.pages);
 await expect(prepareCustomLabels(call(),{source,locale:'tr',deviceId,jobId:old.jobId,copies:1},true)).rejects.toMatchObject({reason:'PRINTER_UNAVAILABLE'});
});
it('@AC-04 foreign data, missing permission, source and package gate are denied without jobs',async()=>{
 const n=await jobs();await expect(previewCustomLabels(call(),{source:{kind:'PRODUCT',ids:[w.B.itemNoneId]},locale:'en'})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(prepareCustomLabels(call(),{source:{kind:'RECEIPT',documentId:receipt},locale:'tr',jobId:randomUUID(),copies:1},false)).rejects.toMatchObject({code:'FORBIDDEN'});
 const member=()=>w.call(w.A,w.A.memberUserId,false);await w.grant(w.A,[]);await expect(getLabelPrintChoices(member(),'PRODUCT')).rejects.toMatchObject({code:'FORBIDDEN'});
 await w.grant(w.A,['labels.print']);expect((await getLabelPrintChoices(member(),'PRODUCT')).length).toBeGreaterThan(0);
 // PICKER already has stock.view; printing does not require designer/view permission.
 const result=await previewCustomLabels(member(),{source:productSource(),locale:'en'});expect(result.pages).toHaveLength(1);expect(await jobs()).toBe(n);
});
it('warehouse scope is rechecked for current records, including reprint and history',async()=>{
 const source={kind:'RECEIPT',documentId:receipt},original=await prepareCustomLabels(call(),{source,locale:'tr',jobId:randomUUID(),copies:1},true);
 const foreignWarehouse=randomUUID();await w.adm.query("INSERT INTO public.warehouses(tenant_id,id,code,name) VALUES($1,$2,'SCOPED-OTHER','Other')",[w.A.tenantId,foreignWarehouse]);
 await w.adm.query('INSERT INTO public.membership_warehouse_scopes(tenant_id,membership_id,warehouse_id) VALUES($1,$2,$3)',[w.A.tenantId,w.A.memberMembershipId,foreignWarehouse]);
 const prior=process.env.WAREHOUSE_SCOPE_ENABLED;process.env.WAREHOUSE_SCOPE_ENABLED='true';try{await expect(readPreparedLabels(w.call(w.A,w.A.memberUserId,false),original.jobId,true)).rejects.toMatchObject({code:'NOT_FOUND'});}finally{if(prior===undefined)delete process.env.WAREHOUSE_SCOPE_ENABLED;else process.env.WAREHOUSE_SCOPE_ENABLED=prior;}
});
it('render/required binding failure and failed audit leave neither job nor stock effect',async()=>{
 const before=await unchangedStock(),n=await jobs(),t=await publish('PRODUCT');
 const p=await saveLabelTemplate(call(),{id:t.id,expectedVersion:t.version,name:'No barcode',design:{...readyLabelDesign('PRODUCT'),elements:readyLabelDesign('PRODUCT').elements.filter(e=>e.kind!=='qr'&&e.kind!=='barcode')}});await publishLabelTemplate(call(),{id:t.id,expectedVersion:p.version});
 await expect(prepareCustomLabels(call(),{source:productSource(),templateId:t.id,locale:'en',jobId:randomUUID(),copies:1})).rejects.toBeDefined();
 await w.adm.query("CREATE FUNCTION label_print_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='label.print_prepared' THEN RAISE EXCEPTION 'SYNTHETIC_PRINT_FAULT'; END IF; RETURN NEW; END$$");await w.adm.query('CREATE TRIGGER label_print_fault BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION label_print_fault()');
 try{await expect(prepareCustomLabels(call(),{source:productSource(),locale:'en',jobId:randomUUID(),copies:1})).rejects.toMatchObject({code:'INTERNAL'});}finally{await w.adm.query('DROP TRIGGER label_print_fault ON public.audit_logs');await w.adm.query('DROP FUNCTION label_print_fault()');}
 expect(await jobs()).toBe(n);expect(await unchangedStock()).toEqual(before);
});
it('location labels bind actual rack/warehouse and malformed source fields/copies are rejected',async()=>{
 const p=await previewCustomLabels(call(),{source:{kind:'LOCATION',warehouseId:w.A.warehouseId,ids:[w.A.rootLocationId]},locale:'en'});expect(p.context).toBe('LOCATION');expect(p.pages).toHaveLength(1);
 await expect(previewCustomLabels(call(),{source:{kind:'PRODUCT',ids:[product],values:{barcode:'FAKE'}},locale:'en'})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 await expect(prepareCustomLabels(call(),{source:productSource(),locale:'en',jobId:randomUUID(),copies:101})).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 await expect(previewCustomLabels(call(),{source:{kind:'RECEIPT',documentId:w.A.documentId},locale:'en'},true)).rejects.toMatchObject({code:'NOT_FOUND'});
});

it('print-only role can list choices but cannot read stock without its independent grant',async()=>{
 const member=()=>w.call(w.A,w.A.memberUserId,false);await w.grant(w.A,['labels.print']);await w.adm.query('DELETE FROM public.membership_roles WHERE tenant_id=$1 AND membership_id=$2',[w.A.tenantId,w.A.memberMembershipId]);
 try{expect((await getLabelPrintChoices(member(),'PRODUCT')).length).toBeGreaterThan(0);await expect(previewCustomLabels(member(),{source:productSource(),locale:'en'})).rejects.toMatchObject({code:'FORBIDDEN'});}finally{await w.adm.query("INSERT INTO public.membership_roles(tenant_id,membership_id,role_key) VALUES($1,$2,'PICKER')",[w.A.tenantId,w.A.memberMembershipId]);}
});
it('changed barcode blocks physical historical reprint but keeps authorized historical view accessible',async()=>{
 const original=await prepareCustomLabels(call(),{source:productSource(),locale:'en',jobId:randomUUID(),copies:1});await w.adm.query("UPDATE public.item_barcodes SET barcode='ETK-PRODUCT-CHANGED' WHERE tenant_id=$1 AND item_id=$2",[w.A.tenantId,product]);
 try{expect((await readPreparedLabels(call(),original.jobId)).pages).toEqual(original.pages);await expect(prepareCustomLabels(call(),{source:original.source,locale:'en',jobId:randomUUID(),copies:1,reprintOf:original.jobId,reason:'Damaged'})).rejects.toMatchObject({reason:'SOURCE_CHANGED'});}finally{await w.adm.query("UPDATE public.item_barcodes SET barcode='ETK-PRODUCT-ONE' WHERE tenant_id=$1 AND item_id=$2",[w.A.tenantId,product]);}
});

it('production labels use persisted output package QR and complete dates after atomic posting',async()=>{
 await w.adm.query('UPDATE public.tenant_settings SET receiving_qc_enabled=true WHERE tenant_id=$1',[w.A.tenantId]);const storage=randomUUID(),output=randomUUID();await w.adm.query("INSERT INTO public.locations(tenant_id,id,warehouse_id,code,name,depth,kind) VALUES($1,$2,$3,'LABEL-PRODUCTION','Production',0,'STORAGE')",[w.A.tenantId,storage,w.A.warehouseId]);
 await w.adm.query("INSERT INTO public.items(tenant_id,id,code,name,base_unit_id,tracking_mode,quantity_scale) VALUES($1,$2,'LABEL-OUTPUT','Rubber output',$3,'LOT',3)",[w.A.tenantId,output,w.A.unitId]);
 const d=await preparePackageReceipt(stock(),{warehouseId:w.A.warehouseId,receivingLocationId:receiving,itemId:item,unitId:w.A.unitId,kind:'VARIL',packages:{mode:'equal',count:1,quantity:'200',lotCode:'RAW-PRODUCTION',producedOn:'2026-10-01',expiresOn:'2027-10-01'}});await postPackageReceipt(stock(),{documentId:d.documentId as string,expectedVersion:1});const input=(await getPackageReceipt(stock(),{documentId:d.documentId as string})).packages[0]!;
 const version=async()=>{const c=await getCurrentPackage(stock(),{packageId:input.id});if(c.currentBalanceVersion===null)throw new Error('expected balance');return{packageId:input.id,predecessorVersion:c.predecessorVersion,currentBalanceVersion:c.currentBalanceVersion};};
 await approvePackageQuality(stock(),await version());await putawayPackage(stock(),{...await version(),targetLocationId:storage});
 const recipe=await createProductionRecipe(stock(),{code:'LABEL-PRODUCTION',version:1,name:'Label fixture',outputItemId:output,outputQuantity:'10',lines:[{itemId:item,quantity:'50'}]});
 const prepared=await preparePackageProduction(stock(),{recipeId:recipe.recipeId,recipeVersion:1,outputQuantity:'10',targetLocationId:storage,inputs:[{...await version(),baseQuantity:'50'}],outputs:{kind:'KOLI',packages:{mode:'equal',count:2,quantity:'5',lotCode:'OUTPUT-ONE',producedOn:'2026-11-01',expiresOn:'2028-11-01'}}});
 const batch=await getPackageProductionBatch(stock(),{documentId:prepared.documentId as string}),source={kind:'PRODUCTION',documentId:batch.documentId};await expect(previewCustomLabels(call(),{source,locale:'tr'},true)).rejects.toMatchObject({code:'VALIDATION_FAILED'});
 await postPackageProduction(stock(),{documentId:batch.documentId,expectedVersion:batch.documentVersion});const before=await unchangedStock(),job=await prepareCustomLabels(call(),{source,locale:'tr',jobId:randomUUID(),copies:1},true);expect(job.pages).toHaveLength(2);
 const snapshots=(await w.adm.query('SELECT snapshot FROM public.label_print_jobs WHERE tenant_id=$1 AND id=$2',[w.A.tenantId,job.jobId])).rows[0]!.snapshot;expect(snapshots.map((s:{values:{packageQr:string}})=>s.values.packageQr).sort()).toEqual(batch.packages.map(p=>'EWMS:PKG:1:'+p.id).sort());expect(snapshots.every((s:{values:Record<string,string>})=>s.values.quantity==='5'&&s.values.lot==='OUTPUT-ONE'&&s.values.expiryDate==='01.11.2028')).toBe(true);expect(await unchangedStock()).toEqual(before);
});
it('posted plain outbound labels bind document number without fabricating a package identity',async()=>{
 const d=await createStockDocument(stock(),{kind:'STOCK_OUT',warehouseId:w.A.warehouseId,businessDate:'2026-11-01',lines:[{itemId:product,unitId:w.A.unitId,quantity:'1',conversionFactor:'1',baseQuantity:'1',sourceLocationId:w.A.rootLocationId,stockStatus:'AVAILABLE'}]});const source={kind:'SHIPMENT',documentId:d.documentId as string};
 await expect(previewCustomLabels(call(),{source,locale:'tr'},true)).rejects.toMatchObject({code:'VALIDATION_FAILED'});await approveDocument(stock(),{documentId:d.documentId as string,expectedVersion:1});await postDocument(stock(),{documentId:d.documentId as string,expectedVersion:2});
 const before=await unchangedStock(),job=await prepareCustomLabels(call(),{source,locale:'tr',jobId:randomUUID(),copies:1},false);expect(job.context).toBe('SHIPMENT');expect(job.pages).toHaveLength(1);const snapshots=(await w.adm.query('SELECT snapshot FROM public.label_print_jobs WHERE tenant_id=$1 AND id=$2',[w.A.tenantId,job.jobId])).rows[0]!.snapshot;expect(snapshots[0].values.documentNo).toBe((await w.adm.query('SELECT number FROM public.documents WHERE tenant_id=$1 AND id=$2',[w.A.tenantId,d.documentId])).rows[0]!.number);expect(snapshots[0].values.packageQr).toBeUndefined();expect(snapshots[0].packageCodeRequired).toBe(false);expect(await unchangedStock()).toEqual(before);
});
