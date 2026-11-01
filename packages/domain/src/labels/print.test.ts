import{describe,expect,it}from'vitest';
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
});
