import{describe,expect,it}from'vitest';
import{renderLabelSvg,type LabelDesign}from'@wms/shared/labels';
import{labelRequestFingerprint,parseLabelSnapshot,type LabelPrepareInput}from'./print.ts';
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const input:LabelPrepareInput={jobId:a,copies:1,locale:'tr',source:{kind:'PRODUCT',ids:[a,b]}};
const row=()=>({schema:1,requestHash:'a'.repeat(64),source:{kind:'PRODUCT',id:a},values:{name:'SBR',barcode:'ETK-001'},required:['name','barcode'],packageCodeRequired:false,calibration:{dpi:203,offsetX:0,offsetY:0},locale:'tr'});
describe('immutable label request and snapshot contract',()=>{
 it('same source selection has one fingerprint, changed copies/template/source/device do not',()=>{
  const hash=labelRequestFingerprint(input);expect(hash).toMatch(/^[0-9a-f]{64}$/);expect(labelRequestFingerprint({...input,jobId:b,source:{kind:'PRODUCT',ids:[b,a]}})).toBe(hash);
  for(const change of[{copies:2},{templateId:a},{deviceId:a},{source:{kind:'PRODUCT',ids:[a]}},{locale:'en' as const}])expect(labelRequestFingerprint({...input,...change})).not.toBe(hash);
 });
 it('reads only closed, coherent source/locale/calibration snapshots',()=>{
  expect(parseLabelSnapshot([row()],'PRODUCT')).toHaveLength(1);
  for(const raw of[[],[...Array.from({length:101},row)],[{...row(),url:'http://localhost'}],[{...row(),values:{...row().values,price:'50'}}],[{...row(),calibration:{dpi:1200,offsetX:0,offsetY:0}}],[{...row(),calibration:{dpi:203,offsetX:10001,offsetY:0}}],[{...row(),required:['barcode','barcode']}],[row(),{...row(),source:{kind:'PRODUCT',id:b},requestHash:'b'.repeat(64)}]])expect(()=>parseLabelSnapshot(raw,'PRODUCT')).toThrow();
 });
 it('foreign-context or invented source identities cannot become a saved product label',()=>{
  expect(()=>parseLabelSnapshot([{...row(),source:{kind:'LOCATION',id:a,warehouseId:b}}],'PRODUCT')).toThrow();
  expect(()=>parseLabelSnapshot([{...row(),source:{kind:'PRODUCT',id:'ETK-001'}}],'PRODUCT')).toThrow();
  expect(()=>parseLabelSnapshot([{...row(),source:{kind:'SCRIPT',id:a}}],'PRODUCT')).toThrow();
 });
 it('an oversized EAN13 box keeps physical module width within 200% and its caption near the symbol',()=>{
  const d:LabelDesign={schema:1,context:'PRODUCT',width:200000,height:120000,margin:2000,elements:[{id:'ean',kind:'barcode',field:'barcode',format:'EAN13',x:5000,y:5000,width:180000,height:100000,rotation:0,locked:false}]};
  for(const dpi of[203,300,600] as const){const svg=renderLabelSvg(d,{barcode:'4006381333931'},{dpi}),bars=[...svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];expect(bars.length).toBeGreaterThan(20);expect(Math.max(...bars.map(b=>Number(b[2])))).toBeLessThanOrEqual(660);expect(Math.min(...bars.map(b=>Number(b[2])))).toBeGreaterThanOrEqual(330);const bottom=Math.max(...bars.map(b=>Number(b[1])+Number(b[3]))),caption=Number(/<text x="[^"]+" y="([^"]+)"/.exec(svg)?.[1]);expect(caption-bottom).toBeGreaterThan(0);expect(caption-bottom).toBeLessThanOrEqual(4000);}
 });

});
