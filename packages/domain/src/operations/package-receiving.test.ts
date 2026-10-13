import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalPackageReceiptInput, postPackageReceipt, preparePackageReceipt } from "./package-receiving.ts";
import { requestHash, type StockDocCallParams } from "../stock/index.ts";
const ids={warehouseId:randomUUID(),receivingLocationId:randomUUID(),itemId:randomUUID(),unitId:randomUUID()};
const valid={...ids,kind:"VARIL" as const,packages:{mode:"equal",count:5,quantity:"200"}};
const params:StockDocCallParams={db:undefined as never,principal:null,tenantSlug:"test",clientKey:randomUUID()};
describe("T-933 canonical package command input",()=> {
  it("equal and explicit payloads share hash, decimals/text normalize, request id excluded",()=> {
    const a=canonicalPackageReceiptInput({...valid,supplierRef:" TED ",requestId:"one"});
    const b=canonicalPackageReceiptInput({...valid,supplierRef:"TED",requestId:"two",packages:{mode:"explicit",packages:Array.from({length:5},()=>({quantity:"0200.000000"}))}});
    expect(a).toEqual(b);expect(requestHash(a)).toBe(requestHash(b));
    expect(a.packages).toHaveLength(5);expect(a.packages[0]).toEqual({quantity:"200"});
  });
  it("row order and physical metadata enter the hash",()=> {
    const a=canonicalPackageReceiptInput({...valid,packages:{mode:"explicit",packages:[{quantity:"1"},{quantity:"2"}]}});
    const b=canonicalPackageReceiptInput({...valid,packages:{mode:"explicit",packages:[{quantity:"2"},{quantity:"1"}]}});
    expect(requestHash(a)).not.toBe(requestHash(b));
    expect(requestHash(a)).not.toBe(requestHash(canonicalPackageReceiptInput({...valid,packages:{mode:"explicit",packages:[{quantity:"1",lotCode:"PHYSICAL"},{quantity:"2"}]}})));
  });
  for(const field of ["tenantId","packageId","handlingUnitId","lotId","factor","baseQuantity","status","damagedQuantity","cancelled"]) it(`rejects ${field} injection before DB access`,async()=> {
    await expect(preparePackageReceipt(params,{...valid,[field]:randomUUID()} as never)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
  it("rejects unrecognized nested fields and final invalid package",async()=> {
    await expect(preparePackageReceipt(params,{...valid,packages:{mode:"explicit",packages:[{quantity:"1"},{quantity:"2",status:"AVAILABLE"}]}})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(preparePackageReceipt(params,{...valid,packages:{mode:"explicit",packages:[{quantity:"1"},{quantity:"0"}]}})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
  it("post rejects version and status injection",async()=> {
    await expect(postPackageReceipt(params,{documentId:randomUUID(),expectedVersion:0})).rejects.toMatchObject({code:"VALIDATION_FAILED"});
    await expect(postPackageReceipt(params,{documentId:randomUUID(),expectedVersion:1,status:"POSTED"} as never)).rejects.toMatchObject({code:"VALIDATION_FAILED"});
  });
});
