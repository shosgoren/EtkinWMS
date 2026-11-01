// katman: db, file
import { randomUUID } from "node:crypto";
import { afterAll,beforeAll,expect,it } from "vitest";
import { defaultLabelDesign, type LabelElement } from "../../../packages/shared/src/labels/index.ts";
import { saveLabelTemplate,getLabelWorkspace,saveLabelPrinter,setLabelPrinterPreference,getLabelPrinterChoice,uploadLabelLogo,readLabelLogo } from "../../../packages/domain/src/labels/store.ts";
import { labelServiceWorld,tinyLabelPng } from "./service-fixture.ts";
let w:Awaited<ReturnType<typeof labelServiceWorld>>;
beforeAll(async()=>{w=await labelServiceWorld();},120000);afterAll(async()=>{await w?.dispose();});
const profile=(name:string)=>saveLabelPrinter(w.call(),{expectedVersion:0,name,dpi:203,offsetX:0,offsetY:0,active:true});
it("@AC-04 logo uploads are canonical, deduplicated per tenant and inaccessible across tenants",async()=>{
 const png=tinyLabelPng(),logo=await uploadLabelLogo(w.call(),png);expect(await uploadLabelLogo(w.call(),png)).toEqual(logo);expect((await readLabelLogo(w.call(),logo.id)).subarray(0,8)).toEqual(png.subarray(0,8));
 await expect(readLabelLogo(w.call(w.B),logo.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 const own=await uploadLabelLogo(w.call(w.B),png);expect(own.id).not.toBe(logo.id);
 const d=defaultLabelDesign("PRODUCT"),shape:LabelElement={id:"logo",kind:"logo",assetId:own.id,x:2000,y:30000,width:10000,height:10000,rotation:0,locked:false};
 await expect(saveLabelTemplate(w.call(),{expectedVersion:0,name:"Foreign logo",design:{...d,elements:[...d.elements,shape]}})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(uploadLabelLogo(w.call(),Buffer.from("<svg><script/></svg>"))).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 expect((await w.adm.query("SELECT count(*)::int AS n FROM public.label_assets WHERE tenant_id=$1",[w.A.tenantId])).rows[0]?.n).toBe(1);
 const saved=await saveLabelTemplate(w.call(),{expectedVersion:0,name:"Own logo",design:{...d,elements:[...d.elements,{...shape,assetId:logo.id}]}});expect(saved.version).toBe(1);
});
it("template/device preference overrides general; an unavailable explicit profile never silently falls back",async()=>{
 const t=await saveLabelTemplate(w.call(),{expectedVersion:0,name:"Printer template",design:defaultLabelDesign("PRODUCT")}),device=randomUUID(),otherDevice=randomUUID();
 const a=await profile("General"),b=await profile("Device"),c=await profile("Template"),d=await profile("Template device");
 const choice=()=>getLabelPrinterChoice(w.call(),{templateId:t.id,deviceId:device});
 expect(await choice()).toEqual({kind:"dialog",profileId:null,name:null,requiresSelection:true});
 await setLabelPrinterPreference(w.call(),{templateId:null,deviceId:null,printerId:a.id,expectedVersion:0});expect((await choice()).profileId).toBe(a.id);
 await setLabelPrinterPreference(w.call(),{templateId:null,deviceId:device,printerId:b.id,expectedVersion:0});expect((await choice()).profileId).toBe(b.id);
 await setLabelPrinterPreference(w.call(),{templateId:t.id,deviceId:null,printerId:c.id,expectedVersion:0});expect((await choice()).profileId).toBe(c.id);
 const selected=await setLabelPrinterPreference(w.call(),{templateId:t.id,deviceId:device,printerId:d.id,expectedVersion:0});expect((await choice()).profileId).toBe(d.id);
 expect((await getLabelPrinterChoice(w.call(),{templateId:t.id,deviceId:otherDevice})).profileId).toBe(c.id);
 await saveLabelPrinter(w.call(),{id:d.id,expectedVersion:d.version,name:"Inactive",dpi:203,offsetX:0,offsetY:0,active:false});expect(await choice()).toEqual({kind:"blocked",profileId:d.id,reason:"UNAVAILABLE"});
 await expect(setLabelPrinterPreference(w.call(),{templateId:t.id,deviceId:device,printerId:d.id,expectedVersion:selected.version})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(setLabelPrinterPreference(w.call(),{templateId:t.id,deviceId:device,printerId:c.id,expectedVersion:0})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
 await setLabelPrinterPreference(w.call(),{templateId:t.id,deviceId:device,printerId:null,expectedVersion:selected.version});expect((await choice()).profileId).toBe(c.id);
});
it("@AC-04 device id cannot read another user's preference or reference another tenant's profile/template",async()=>{
 const t=await saveLabelTemplate(w.call(),{expectedVersion:0,name:"Scope",design:defaultLabelDesign("PRODUCT")}),device=randomUUID(),p=await profile("Personal");
 await setLabelPrinterPreference(w.call(),{templateId:t.id,deviceId:device,printerId:p.id,expectedVersion:0});
 await w.grant(w.A,["labels.view","labels.print"]);
 const member=w.call(w.A,w.A.memberUserId,false),workspace=await getLabelWorkspace(member,{deviceId:device});expect(workspace.preferences.filter(r=>r.personal)).toEqual([]);
 expect((await getLabelPrinterChoice(member,{templateId:t.id,deviceId:device})).profileId).not.toBe(p.id);
 const foreign=await saveLabelPrinter(w.call(w.B),{expectedVersion:0,name:"Foreign",dpi:203,offsetX:0,offsetY:0,active:true});
 await expect(setLabelPrinterPreference(w.call(),{templateId:t.id,deviceId:null,printerId:foreign.id,expectedVersion:0})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(saveLabelPrinter(w.call(),{id:foreign.id,expectedVersion:1,name:"No",dpi:203,offsetX:0,offsetY:0,active:true})).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(getLabelPrinterChoice(w.call(w.B),{templateId:t.id,deviceId:device})).rejects.toMatchObject({code:"NOT_FOUND"});
});
it("logo design and printer management need separate current grants; printer MFA cannot be bypassed",async()=>{
 await w.grant(w.A,["labels.view","labels.print"]);const member=w.call(w.A,w.A.memberUserId,false);
 await expect(uploadLabelLogo(member,tinyLabelPng())).rejects.toMatchObject({code:"FORBIDDEN"});
 const input={expectedVersion:0,name:"No",dpi:203 as const,offsetX:0,offsetY:0,active:true};
 await expect(saveLabelPrinter(member,input)).rejects.toMatchObject({code:"FORBIDDEN"});
 await w.grant(w.A,["labels.view","labels.printers"]);await expect(saveLabelPrinter(member,input)).rejects.toMatchObject({code:"FORBIDDEN",detail:"MFA_REQUIRED"});
 const made=await saveLabelPrinter(w.call(w.A,w.A.memberUserId,true),input);expect(made.version).toBe(1);
 await expect(saveLabelPrinter(w.call(),{...input,id:made.id,expectedVersion:99})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
 await expect(saveLabelPrinter(w.call(),{...input,offsetX:10001})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
 await expect(setLabelPrinterPreference(w.call(),{templateId:null,deviceId:"invalid",printerId:null,expectedVersion:0})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
});
