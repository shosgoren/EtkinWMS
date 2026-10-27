import { z } from "zod";

export const extraFilterShape = {
  category: z.string().trim().max(200).default(""),
  tracking: z.enum(["", "NONE", "LOT", "SERIAL", "LOT_AND_SERIAL"]).default(""),
  barcode: z.enum(["", "PRESENT", "MISSING"]).default(""),
};
const schema = z.object(extraFilterShape);
export type ItemExtraFilters = z.infer<typeof schema>;
export function parseExtraFilters(sp: Record<string, string | string[] | undefined>): ItemExtraFilters | null {
  const result = schema.safeParse({ category: sp.category, tracking: sp.tracking, barcode: sp.barcode });
  return result.success ? result.data : null;
}
export function domainExtraFilters(input: ItemExtraFilters) {
  return {
    ...(input.category === "" ? {} : { category: input.category }),
    ...(input.tracking === "" ? {} : { trackingMode: input.tracking }),
    ...(input.barcode === "" ? {} : { barcode: input.barcode }),
  };
}
export function extraFilterParams(input: ItemExtraFilters, p = new URLSearchParams()): URLSearchParams {
  for (const key of ["category", "tracking", "barcode"] as const) if (input[key] !== "") p.set(key, input[key]);
  return p;
}
