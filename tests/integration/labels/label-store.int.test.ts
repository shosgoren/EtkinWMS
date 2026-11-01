// katman: db, export
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,expect,it } from "vitest";
import { defaultLabelDesign, type LabelContext } from "../../../packages/shared/src/labels/index.ts";
import { saveLabelTemplate,publishLabelTemplate,getLabelTemplate,getLabelWorkspace,assignLabelDefault,archiveLabelTemplate,restoreLabelDraft,exportLabelDesigns } from "../../../packages/domain/src/labels/store.ts";
import { labelServiceWorld } from "./service-fixture.ts";
let w:Awaited<ReturnType<typeof labelServiceWorld>>;
beforeAll(async()=>{w=await labelServiceWorld();},120000);afterAll(async()=>{await w?.dispose();});
const create=async(context:LabelContext="PRODUCT")=>saveLabelTemplate(w.call(),{id:randomUUID(),expectedVersion:0,name:randomUUID(),design:defaultLabelDesign(context)});
const audits=async()=>Number((await w.adm.query("SELECT count(*) AS n FROM public.audit_logs WHERE tenant_id=$1 AND action LIKE 'label.%'",[w.A.tenantId])).rows[0]?.n);
it("@AC-04 custom label commands do not read or mutate a foreign tenant/template",async()=>{
 const foreign=await saveLabelTemplate(w.call(w.B),{expectedVersion:0,name:"Other",design:defaultLabelDesign("PRODUCT")});
 await expect(getLabelTemplate(w.call(),foreign.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(saveLabelTemplate(w.call(),{id:foreign.id,expectedVersion:1,name:"Attempt",design:defaultLabelDesign("PRODUCT")})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(publishLabelTemplate(w.call(),{id:foreign.id,expectedVersion:1})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(assignLabelDefault(w.call(),{id:foreign.id,expectedDefaultVersion:0})).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await getLabelWorkspace(w.call())).templates.map(t=>t.id)).not.toContain(foreign.id);
 await expect(getLabelWorkspace({...w.call(),tenantSlug:w.B.slug})).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("view/design/publish are independent; sensitive grant is enforced with fresh MFA and revoked rights",async()=>{
 const member=()=>w.call(w.A,w.A.memberUserId,false);
 await expect(getLabelWorkspace(member())).rejects.toMatchObject({code:"FORBIDDEN"});
 await w.grant(w.A,["labels.view"]);expect((await getLabelWorkspace(member())).rights.design).toBe(false);
 await expect(saveLabelTemplate(member(),{expectedVersion:0,name:"No",design:defaultLabelDesign("PRODUCT")})).rejects.toMatchObject({code:"FORBIDDEN"});
 await w.grant(w.A,["labels.view","labels.design"]);
 const t=await saveLabelTemplate(member(),{expectedVersion:0,name:"Allowed draft",design:defaultLabelDesign("PRODUCT")});
 await expect(publishLabelTemplate(member(),{id:t.id,expectedVersion:t.version})).rejects.toMatchObject({code:"FORBIDDEN"});
 await w.grant(w.A,["labels.view","labels.design","labels.publish"]);
 await expect(publishLabelTemplate(member(),{id:t.id,expectedVersion:t.version})).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
 expect((await publishLabelTemplate(w.call(w.A,w.A.memberUserId,true),{id:t.id,expectedVersion:t.version})).publishedVersionId).toMatch(/^[a-f0-9-]{36}$/);
 await w.grant(w.A,[]);await expect(getLabelTemplate(member(),t.id)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it("draft saves are idempotent, explicit publication/default is atomic, and restore never rewrites an old version",async()=>{
 const before=await w.adm.query("SELECT id,quantity::text,document_line_id FROM public.stock_ledger WHERE tenant_id=$1 ORDER BY id",[w.A.tenantId]);
 const id=randomUUID(),design=defaultLabelDesign("PRODUCT"),t=await saveLabelTemplate(w.call(),{id,expectedVersion:0,name:"Stable",design});
 const n=await audits();expect(await saveLabelTemplate(w.call(),{id,expectedVersion:0,name:"Stable",design})).toEqual(t);expect(await saveLabelTemplate(w.call(),{id,expectedVersion:1,name:"Stable",design})).toEqual(t);expect(await audits()).toBe(n);
 const live=await publishLabelTemplate(w.call(),{id,expectedVersion:1,expectedDefaultVersion:0});expect(live.defaultVersion).toBe(1);
 const changed={...design,elements:design.elements.map(e=>e.kind==="text"?{...e,bold:!e.bold}:e)};
 const draft=await saveLabelTemplate(w.call(),{id,expectedVersion:live.version,name:"Stable",design:changed});
 const read=await getLabelTemplate(w.call(),id);expect(read.published).toEqual(design);expect(read.draft).toEqual(changed);
 const defs=(await getLabelWorkspace(w.call())).defaults.find(d=>d.context==="PRODUCT");expect(defs?.versionId).toBe(live.publishedVersionId);
 await expect(publishLabelTemplate(w.call(),{id,expectedVersion:1})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
 await expect(publishLabelTemplate(w.call(),{id,expectedVersion:draft.version,expectedDefaultVersion:99})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
 expect((await getLabelTemplate(w.call(),id)).revisions).toHaveLength(1);
 const second=await publishLabelTemplate(w.call(),{id,expectedVersion:draft.version,expectedDefaultVersion:1});
 expect(second.defaultVersion).toBe(2);
 const restored=await restoreLabelDraft(w.call(),{id,expectedVersion:second.version,versionId:live.publishedVersionId});
 const after=await getLabelTemplate(w.call(),id);expect(after.version).toBe(restored.version);expect(after.draft).toEqual(design);expect(after.published).toEqual(changed);expect(after.revisions).toHaveLength(2);
 expect((await w.adm.query("SELECT id,quantity::text,document_line_id FROM public.stock_ledger WHERE tenant_id=$1 ORDER BY id",[w.A.tenantId])).rows).toEqual(before.rows);
});
it("stale concurrent editors cannot overwrite; invalid publish/context/foreign restore leave original intact",async()=>{
 const t=await create("LOCATION"),design=defaultLabelDesign("LOCATION");
 const outcomes=await Promise.allSettled(["A","B"].map(name=>saveLabelTemplate(w.call(),{id:t.id,expectedVersion:t.version,name,design})));
 expect(outcomes.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(outcomes.filter(x=>x.status==="rejected").map(x=>(x as PromiseRejectedResult).reason.code)).toEqual(["VERSION_CONFLICT"]);
 const actual=await getLabelTemplate(w.call(),t.id);
 await expect(saveLabelTemplate(w.call(),{id:t.id,expectedVersion:actual.version,name:"Wrong context",design:defaultLabelDesign("PRODUCT")})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 const other=await create("LOCATION"),published=await publishLabelTemplate(w.call(),{id:other.id,expectedVersion:1});
 await expect(restoreLabelDraft(w.call(),{id:t.id,expectedVersion:actual.version,versionId:published.publishedVersionId})).rejects.toMatchObject({code:"NOT_FOUND"});
 const empty=await saveLabelTemplate(w.call(),{expectedVersion:0,name:"Empty",design:{...defaultLabelDesign("RECEIPT"),elements:[]}});
 await expect(publishLabelTemplate(w.call(),{id:empty.id,expectedVersion:1})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 expect((await getLabelTemplate(w.call(),empty.id)).version).toBe(1);
});
it("archiving an assigned template requires an alternative; restore/archive preserve identities and history",async()=>{
 const t=await create("SHIPMENT"),one=await publishLabelTemplate(w.call(),{id:t.id,expectedVersion:1,expectedDefaultVersion:0});
 await expect(archiveLabelTemplate(w.call(),{id:t.id,expectedVersion:one.version,archived:true})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 const other=await create("SHIPMENT");await publishLabelTemplate(w.call(),{id:other.id,expectedVersion:1});await assignLabelDefault(w.call(),{id:other.id,expectedDefaultVersion:1});
 const a=await archiveLabelTemplate(w.call(),{id:t.id,expectedVersion:one.version,archived:true});expect((await getLabelWorkspace(w.call(),{archived:true})).templates.map(x=>x.id)).toContain(t.id);
 await expect(saveLabelTemplate(w.call(),{id:t.id,expectedVersion:a.version,name:"No",design:defaultLabelDesign("SHIPMENT")})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 const b=await archiveLabelTemplate(w.call(),{id:t.id,expectedVersion:a.version,archived:false});expect(b.id).toBe(t.id);expect((await getLabelTemplate(w.call(),t.id)).publishedVersionId).toBe(one.publishedVersionId);
});
it("audit failure rolls back the draft write instead of returning a false saved state",async()=>{
 const t=await create(),before=await getLabelTemplate(w.call(),t.id);
 await w.adm.query("CREATE FUNCTION label_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='label.template_saved' THEN RAISE EXCEPTION 'SYNTHETIC_LABEL_FAULT'; END IF; RETURN NEW; END$$");
 await w.adm.query("CREATE TRIGGER label_test_fault BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION label_test_fault()");
 try{await expect(saveLabelTemplate(w.call(),{id:t.id,expectedVersion:t.version,name:"Must rollback",design:before.draft})).rejects.toMatchObject({code:"INTERNAL"});expect(await getLabelTemplate(w.call(),t.id)).toEqual(before);}
 finally{await w.adm.query("DROP TRIGGER label_test_fault ON public.audit_logs");await w.adm.query("DROP FUNCTION label_test_fault()");}
});
it("@AC-04 template/history exports and lists are bounded/keyset and tenant scoped without billing gates",async()=>{
 const special="Find %_\\ exact";await saveLabelTemplate(w.call(),{expectedVersion:0,name:special,design:defaultLabelDesign("PRODUCT")});expect((await getLabelWorkspace(w.call(),{q:"%_\\"})).templates.map(x=>x.name)).toEqual([special]);
 const design=JSON.stringify(defaultLabelDesign("PRODUCT"));
 await w.adm.query("INSERT INTO public.label_templates(tenant_id,id,name,context,draft,created_by) SELECT $1,gen_random_uuid(),'Paged '||n,'PRODUCT',$2,$3 FROM generate_series(1,56)n",[w.B.tenantId,design,w.B.ownerMembershipId]);
 expect((await getLabelWorkspace(w.call(w.B),{q:"Paged 56"})).templates.map(x=>x.name)).toEqual(["Paged 56"]);
 const page=await getLabelWorkspace(w.call(w.B));expect(page.templates).toHaveLength(50);expect(page.next).not.toBeNull();
 const next=await getLabelWorkspace(w.call(w.B),{after:page.next??undefined});expect(next.templates.length).toBeGreaterThan(0);expect(new Set([...page.templates,...next.templates].map(t=>t.id)).size).toBe(page.templates.length+next.templates.length);
 const ids:string[]=[];let cursor:string|undefined;
 do{const x=await exportLabelDesigns(w.call(w.B),{kind:"TEMPLATES",...(cursor?{after:cursor}:{})});expect(x.rows.length).toBeLessThanOrEqual(25);ids.push(...x.rows.map(r=>(r as {id:string}).id));cursor=x.next??undefined;}while(cursor);
 expect(ids.length).toBe(57);expect(new Set(ids).size).toBe(57);
 const history=await exportLabelDesigns(w.call(),{kind:"VERSIONS"});expect(history.rows.length).toBeGreaterThan(2);expect((await exportLabelDesigns(w.call(w.B),{kind:"VERSIONS"})).rows).toEqual([]);
});
