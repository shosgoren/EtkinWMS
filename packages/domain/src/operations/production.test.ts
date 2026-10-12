import {describe,expect,it} from "vitest";
import {scaleRecipeQuantity} from "./production.ts";
describe("recipe scaling",()=>{
 it("keeps decimal arithmetic exact across different recipe output sizes",()=>{
  expect(scaleRecipeQuantity("0.100001","2","6")).toBe("0.300003");
  expect(scaleRecipeQuantity("2","4","1")).toBe("0.500000");
 });
 it("rejects nonrepresentable, nonpositive and overflowing quantities instead of rounding",()=>{
  for(const args of [["1","3","1"],["0","1","1"],["-1","1","1"],["99999999999999","1","99999999999999"]])expect(()=>scaleRecipeQuantity(args[0]!,args[1]!,args[2]!)).toThrow();
 });
});
