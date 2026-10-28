"use client";
// T-1119 (B-123): kalıp kabının türü ve teması içerikteki ortak parçalara bağlamla iner. `KalipEkran` sağlar; `KalipFormKap` (belge.tsx)
// form kabı dışındaki ekranlarda (ayrıntı) form parçalarının (`KalipGrup`, `KalipAlan`, `KalipSecim`) görünümünü bununla kurar.
import { createContext } from "react";

export type KalipKind = "liste" | "form" | "detay";

export const KalipKapCtx = createContext<{ readonly kind: KalipKind; readonly dark: boolean } | null>(null);
