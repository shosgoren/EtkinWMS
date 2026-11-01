// A browser preference is a hint, never a promise that window.print selected an OS printer.
export interface LabelPrinter { readonly id: string; readonly name: string; readonly mode: "SYSTEM_DIALOG" | "BRIDGE"; readonly active: boolean; readonly bridgeReady: boolean }
export interface PrinterPreferences { readonly templateDevice: string | null; readonly templateCompany: string | null; readonly generalDevice: string | null; readonly generalCompany: string | null }
export type PrinterResolution =
  | { readonly kind: "dialog"; readonly profileId: string | null; readonly name: string | null; readonly requiresSelection: true }
  | { readonly kind: "bridge"; readonly profileId: string; readonly name: string }
  | { readonly kind: "blocked"; readonly profileId: string; readonly reason: "UNAVAILABLE" | "BRIDGE_NOT_READY" };
/** Caller supplies only profiles authorized for the current tenant/user/device. Never fall back from an explicit failed choice. */
export function resolveLabelPrinter(preferences: PrinterPreferences, authorizedProfiles: readonly LabelPrinter[]): PrinterResolution {
  const id = preferences.templateDevice ?? preferences.templateCompany ?? preferences.generalDevice ?? preferences.generalCompany;
  if (id === null) return { kind: "dialog", profileId: null, name: null, requiresSelection: true };
  const matches = authorizedProfiles.filter(p => p.id === id);
  const profile = matches.length === 1 ? matches[0] : undefined;
  if (!profile || profile.active !== true) return { kind: "blocked", profileId: id, reason: "UNAVAILABLE" };
  if (profile.mode === "BRIDGE") return profile.bridgeReady === true ? { kind: "bridge", profileId: id, name: profile.name } : { kind: "blocked", profileId: id, reason: "BRIDGE_NOT_READY" };
  if (profile.mode !== "SYSTEM_DIALOG") return { kind: "blocked", profileId: id, reason: "UNAVAILABLE" };
  return { kind: "dialog", profileId: id, name: profile.name, requiresSelection: true };
}
