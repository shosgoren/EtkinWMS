import{describe,expect,it}from'vitest';
import{formatLabelDate,formatLabelQuantity,parseLabelSourceRequest}from'./print-source.ts';
const id='11111111-1111-4111-8111-111111111111';
describe('label source request and exact presentation',()=>{
 it('only selects existing source UUIDs, never values or identity overrides',()=>{
  expect(parseLabelSourceRequest({kind:'PRODUCT',ids:[id]})).toEqual({kind:'PRODUCT',ids:[id]});
  for(const raw of[{kind:'PRODUCT',ids:[id,id]},{kind:'PRODUCT',ids:[]},{kind:'PRODUCT',ids:['barcode']},{kind:'PRODUCT',ids:[id],values:{barcode:'fake'}},{kind:'RECEIPT',documentId:id,tenantId:id},{kind:'SHIPMENT',documentId:id,warehouseId:id}])expect(()=>parseLabelSourceRequest(raw)).toThrow();
 });
 it('locale formatting never loses large decimal quantity digits',()=>{
  expect(formatLabelQuantity('9007199254740993.123456','tr')).toBe('9.007.199.254.740.993,123456');expect(formatLabelQuantity('9007199254740993.123456','en')).toBe('9,007,199,254,740,993.123456');expect(formatLabelQuantity('200.000000','tr')).toBe('200');expect(formatLabelQuantity('0.000001','en')).toBe('0.000001');
  for(const value of['1e3','-1','NaN','1.1234567','1,5','0x10'])expect(()=>formatLabelQuantity(value,'tr')).toThrow();
 });
 it('date-only values cannot shift a day and impossible dates are rejected',()=>{
  expect(formatLabelDate('2026-11-01','tr')).toBe('01.11.2026');expect(formatLabelDate('2026-11-01','en')).toBe('01/11/2026');expect(formatLabelDate(null,'tr')).toBe('');expect(()=>formatLabelDate('2026-02-30','tr')).toThrow();expect(()=>formatLabelDate('2026-11-01T12:00:00Z','en')).toThrow();
 });
});
