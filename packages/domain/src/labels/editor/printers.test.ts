import {describe,expect,it} from "vitest";
import {resolveLabelPrinter,type LabelPrinter,type PrinterPreferences} from "./printers.ts";
const profiles:LabelPrinter[]=["td","tc","gd","gc"].map(id=>({id,name:id,mode:"SYSTEM_DIALOG",active:true,bridgeReady:false}));
const preferences:PrinterPreferences={templateDevice:"td",templateCompany:"tc",generalDevice:"gd",generalCompany:"gc"};
describe("label printer routing",()=>{
 it.each([[{},"td"],[{templateDevice:null},"tc"],[{templateDevice:null,templateCompany:null},"gd"],[{templateDevice:null,templateCompany:null,generalDevice:null},"gc"]])("resolves explicit preference priority %j",(change,chosen)=>expect(resolveLabelPrinter({...preferences,...change},profiles)).toMatchObject({kind:"dialog",profileId:chosen,requiresSelection:true}));
 it("uses the system dialog only when every preference inherits",()=>expect(resolveLabelPrinter({templateDevice:null,templateCompany:null,generalDevice:null,generalCompany:null},profiles)).toEqual({kind:"dialog",profileId:null,name:null,requiresSelection:true}));
 it("does not silently fall back from an inaccessible template-specific printer",()=>expect(resolveLabelPrinter(preferences,profiles.filter(p=>p.id!=="td"))).toEqual({kind:"blocked",profileId:"td",reason:"UNAVAILABLE"}));
 it("does not silently fall back from an inactive or ambiguous printer",()=>{for(const list of [[{...profiles[0]!,active:false},...profiles.slice(1)],[...profiles,profiles[0]!]])expect(resolveLabelPrinter(preferences,list)).toMatchObject({kind:"blocked",reason:"UNAVAILABLE"});});
 it("never claims window.print can choose a particular physical device",()=>expect(resolveLabelPrinter(preferences,profiles)).toMatchObject({kind:"dialog",requiresSelection:true}));
 it("requires an actually ready bridge before routing to a device",()=>{const bridge={...profiles[0]!,mode:"BRIDGE" as const};expect(resolveLabelPrinter(preferences,[bridge])).toEqual({kind:"blocked",profileId:"td",reason:"BRIDGE_NOT_READY"});expect(resolveLabelPrinter(preferences,[{...bridge,bridgeReady:true}])).toEqual({kind:"bridge",profileId:"td",name:"td"});});
});
