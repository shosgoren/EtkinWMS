import { KalipKart } from "./liste.tsx";
import { fmtQty } from "./format.ts";

export interface KalipGorevBilgi {
  readonly itemName: string | null;
  readonly itemCode: string | null;
  readonly warehouseName: string | null;
  readonly locationCode: string | null;
  readonly locationName: string | null;
  readonly quantity: string | null;
}

/** Görev kimliği yerine iş bilgisi; depo/raf mobilde gizlenen `.um` satırına konmaz. */
export function KalipGorevKarti({ task, kind, status, quantityLabel, locale, d, color, index = 0 }: {
  task: KalipGorevBilgi;
  kind: string;
  status: string;
  quantityLabel: string;
  locale: string;
  d: string;
  color: string;
  index?: number;
}) {
  const name = task.itemName ?? kind;
  const location = [task.locationCode, task.locationName].filter((v, i, all) => v !== null && all.indexOf(v) === i).join(" · ");
  const code = [task.itemCode, kind, status].filter((v) => v !== null).join(" · ");
  const quantity = task.quantity === null ? null : fmtQty(task.quantity, locale);
  const aria = [name, code, task.warehouseName, location, quantity === null ? null : `${quantity} ${quantityLabel}`].filter((v) => v !== null && v !== "").join(" · ");
  return (
    <KalipKart passive name={name} code={code} d={d} color={color} index={index} role={null} aria={aria}
      {...(quantity === null ? {} : { badge: { value: quantity, sub: quantityLabel } })}>
      {task.warehouseName === null ? null : <small title={task.warehouseName}>{task.warehouseName}</small>}
      {location === "" ? null : <small title={location}>{location}</small>}
    </KalipKart>
  );
}
