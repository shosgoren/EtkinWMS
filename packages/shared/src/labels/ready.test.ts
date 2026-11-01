import{describe,it,expect}from'vitest';
import{readyLabelDesign}from'./ready.ts';
import{LABEL_CONTEXTS,parseLabelDesign,prepareLabelForPrint}from'./model.ts';
import{renderLabelSvg}from'./render.ts';
describe('ready label designs protect first use',()=>{
 it.each(LABEL_CONTEXTS)('%s remains editable, publishable and context-bound',context=>{
  const d=readyLabelDesign(context);expect(parseLabelDesign(d)).toEqual(d);expect(d.elements.some(e=>e.kind==='qr'&&e.locked)).toBe(true);
  expect(d.elements.every(e=>e.kind!=='text'||e.text===null||!e.text.includes('DEMO'))).toBe(true);
 });
 it('receipt carries all real tracking fields and one existing package identity',()=>{
  const d=readyLabelDesign('RECEIPT');expect(prepareLabelForPrint(d,['lot','productionDate','expiryDate','quantity','unit','packageQr'])).toEqual(d);
  const svg=renderLabelSvg(d,{name:'SBR granül',code:'HM-001',packageQr:'EWMS:PKG:1:11111111-1111-4111-8111-111111111111',quantity:'200,125',unit:'KG',lot:'LOT-2026-01',productionDate:'01.11.2026',expiryDate:'01.11.2027',documentNo:'DVR-2026-001'});
  for(const v of['200,125','KG','LOT-2026-01','01.11.2026','01.11.2027','DVR-2026-001'])expect(svg).toContain(v);
 });
 it('shipment default uses the trusted automatic code; explicit package bindings still require a real package',()=>{
  const d=readyLabelDesign('SHIPMENT');expect(renderLabelSvg(d,{name:'Ürün',documentNo:'SVK-1',trackingCode:'SVK-1'})).toContain('SVK-1');
  const physical={...d,elements:d.elements.map(e=>e.kind==='qr'?{...e,field:'packageQr' as const}:e)};expect(()=>renderLabelSvg(physical,{name:'Ürün',documentNo:'SVK-1'})).toThrow();
  expect(renderLabelSvg(d,{name:'Ürün',documentNo:'SVK-1',trackingCode:'EWMS:PKG:1:11111111-1111-4111-8111-111111111111',packageQr:'EWMS:PKG:1:11111111-1111-4111-8111-111111111111'})).toContain('SVK-1');
 });
 it('optional blank trace fields are not filled with sample data',()=>{
  const svg=renderLabelSvg(readyLabelDesign('RECEIPT'),{name:'SBR',packageQr:'EWMS:PKG:1:11111111-1111-4111-8111-111111111111'});expect(svg).not.toContain('LOT-2026');expect(svg).not.toContain('undefined');
 });
});

it('shipment automatic code satisfies required package binding without weakening receipts or the real document field',()=>{const d=readyLabelDesign('SHIPMENT');expect(d.elements.find(e=>e.kind==='qr')?.field).toBe('trackingCode');expect(prepareLabelForPrint(d,['name','quantity','unit','documentNo','packageQr'])).toEqual(d);const withoutDoc={...d,elements:d.elements.filter(e=>!(e.kind==='text'&&e.field==='documentNo'))};expect(()=>prepareLabelForPrint(withoutDoc,['documentNo','packageQr'])).toThrow();const receipt={...readyLabelDesign('RECEIPT'),elements:readyLabelDesign('RECEIPT').elements.map(e=>e.kind==='qr'?{...e,field:'trackingCode'}:e)};expect(()=>parseLabelDesign(receipt)).toThrow();});
it.each(['PRODUCT','RECEIPT'] as const)('%s ready label prints a real long product identifier without clipping',context=>{
 const code='11111111-1111-4111-8111-111111111111';
 const common={name:'SBR granül',code,unit:'KG'};const values=context==='PRODUCT'?{...common,barcode:'ETK-HM-001'}:{...common,packageQr:'EWMS:PKG:1:'+code,quantity:'200',lot:'LABEL-LOT',productionDate:'01.10.2026',expiryDate:'01.10.2027',documentNo:'GIR-2026-001'};
 const svg=renderLabelSvg(readyLabelDesign(context),values);
 expect(svg.replace(/<[^>]*>/g,'')).toContain(code);expect(svg).toContain('font-size="2000"');
});
