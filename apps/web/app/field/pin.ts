// Saha PIN kuralı (istemci kopyası; `node:crypto` içeren `@wms/shared/field-login` istemci paketine girmez). Sunucu yine kendi kuralını
// uygular (`packages/auth/src/field.ts` `pinAcceptable`); `tests/unit/identity/field-login.test.ts` üç kopyanın eşitliğini denetler.
export type PinProblem = "FORMAT" | "OBVIOUS";

export function pinProblem(pin: string): PinProblem | null {
  if (!/^\d{6}$/.test(pin)) return "FORMAT";
  const d = [...pin].map(Number);
  const same = d.every((x) => x === d[0]);
  const up = d.every((x, i) => i === 0 || x === ((d[i - 1] as number) + 1) % 10);
  const down = d.every((x, i) => i === 0 || x === ((d[i - 1] as number) + 9) % 10);
  return same || up || down ? "OBVIOUS" : null;
}
