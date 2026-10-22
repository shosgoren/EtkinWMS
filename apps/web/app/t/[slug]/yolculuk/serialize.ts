// T-1006: domain yolculuk görünümü → istemci verisi (tarih metin). Sunucu sayfası (Pano) ve eylemler kullanır; yalnız tip içe aktarır.
import type { JourneyView } from "@wms/domain/onboarding/journey";
import type { JourneyData } from "./steps.ts";

export function toJourneyData(v: JourneyView): JourneyData {
  return {
    steps: v.steps.map((s) => ({ key: s.key, done: s.done, skipped: s.skipped, count: s.count })),
    makesProduction: v.makesProduction,
    cardSource: v.cardSource,
    openingStockWanted: v.openingStockWanted,
    done: v.done,
    total: v.total,
    complete: v.complete,
    dismissed: v.dismissed,
    tour: v.tour,
    next: v.next,
    hints: {
      warehouseId: v.hints.warehouseId,
      recipeId: v.hints.recipeId,
      parasut: { connected: v.hints.parasut.connected, openingEnabled: v.hints.parasut.openingEnabled, openingTakenAt: v.hints.parasut.openingTakenAt?.toISOString() ?? null },
    },
  };
}
