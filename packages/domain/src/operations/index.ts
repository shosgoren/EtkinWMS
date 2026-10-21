// Operasyon alanı genel yüzeyi (T-304). YALNIZCA genel komutlar/sorgular/tipler açılır; `createTasks` ve `completeTask` saha
// komutlarının transaction'ı içinden çağrılan iç yardımcılardır (görev `DONE` yalnızca stok etkisiyle aynı transaction'da — ADR-021 §6)
// ve bilerek burada YOKTUR (export testi: tests/integration/operations/tasks.int.test.ts).
export {
  REASON_MAX,
  TASK_KINDS,
  TASK_KIND_PERMISSION,
  TASK_LIST_LIMIT_DEFAULT,
  TASK_LIST_LIMIT_MAX,
  TASK_SOURCE_KINDS,
  TASK_STATUSES,
  assignTask,
  cancelTask,
  claimTask,
  listMyTasks,
  listTasks,
  nextTaskStatus,
  type AssignTaskInput,
  type CancelTaskInput,
  type ClaimTaskInput,
  type ListMyTasksInput,
  type ListTasksInput,
  type TaskCallParams,
  type TaskCursor,
  type TaskEvent,
  type TaskKind,
  type TaskPage,
  type TaskRow,
  type TaskSourceKind,
  type TaskStatus,
} from "./tasks.ts";
// Mal kabul, kalite onayı ve yerleştirme (T-305). `field-posting.ts` saha komutlarının iç bileşik yardımcısıdır: bilerek burada YOKTUR.
export {
  approveQuality,
  cancelInboundReceipt,
  createInboundReceipt,
  openInboundReceipt,
  receiveGoods,
  type ApproveQualityInput,
  type CancelInboundReceiptInput,
  type CreateInboundReceiptInput,
  type InboundReceiptLineInput,
  type QualityDimensionInput,
  type QualityReceiptLineInput,
  type ReceiptTransitionInput,
  type ReceiveGoodsInput,
  type ReceiveLineInput,
} from "./receiving.ts";
export { putaway, type PutawayInput } from "./putaway.ts";
// Mal kabul okuma sorguları (T-313; stock.view, keyset, depo kapsamı).
export {
  RECEIPT_LIST_LIMIT_DEFAULT,
  RECEIPT_LIST_LIMIT_MAX,
  RECEIPT_STATUSES,
  getAvailableAtLocation,
  getInboundReceipt,
  getLocationBrief,
  listInboundReceipts,
  type ListInboundReceiptsInput,
  type LocationBrief,
  type ReceiptCursor,
  type ReceiptDetail,
  type ReceiptLineView,
  type ReceiptPage,
  type ReceiptStatus,
  type ReceiptView,
  type ReceivingLocationView,
} from "./receiving-queries.ts";
// Müşteri siparişi, sipariş tahsisi ve iptal (T-306). `allocation.ts` saf öneri işlevidir (birim testi); `allocateInTx`/`releaseSelected` iç çekirdeklerdir: burada YOKTUR.
export {
  cancelOrderLine,
  cancelSalesOrder,
  createSalesOrder,
  reserveOrder,
  updateDraftOrder,
  type CancelOrderLineInput,
  type CancelSalesOrderInput,
  type CreateSalesOrderInput,
  type OrderAllocationOverride,
  type ReserveOrderInput,
  type SalesOrderLineInput,
  type UpdateDraftOrderInput,
} from "./orders.ts";
// Toplama görevlendirmesi, toplama ve "ürün bulunamadı" (T-307). `reallocateOrderLine` (orders.ts) ve saf kurallar (picking.ts: planPickTasks...) iç yardımcıdır: burada YOKTUR.
export {
  confirmPick,
  createPickAssignment,
  type ConfirmPickInput,
  type ConfirmPickResult,
  type PickAssignmentInput,
  type PickAssignmentResult,
  type PickNotFound,
  type PickReallocation,
} from "./picking.ts";
// Kilitli sayım (T-309): başlatma, giriş, onay, fark fişi, iptal ve terk alarmı sorgusu. `postCountAdjustment` stok kilit planını `countSessionId` ile bildirir;
// `location_count_locks` yazımı yalnızca posting çekirdeğindeki iç yardımcılardadır ve burada YOKTUR.
export {
  COUNT_BLIND_DEFAULT,
  COUNT_MAX_INPUT_LINES,
  COUNT_MAX_LOCATIONS,
  COUNT_REASON_MAX,
  approveCount,
  cancelCount,
  createCountTasks,
  findAbandonedCounts,
  postCountAdjustment,
  recordCount,
  startCount,
  submitCount,
  type AbandonedCount,
  type CancelCountInput,
  type CountCallParams,
  type CountCommandResult,
  type CountDifference,
  type CountStockStatus,
  type CountTransitionInput,
  type CreateCountTasksInput,
  type PostCountAdjustmentInput,
  type RecordCountInput,
  type RecordCountLineInput,
  type StartCountInput,
} from "./counting.ts";
// Sayım ekranları okumaları (T-987): saha raf görünümü (kör), yönetici listesi ve fark incelemesi. Stok/oturum yazmaz.
export {
  COUNT_SESSION_LIST_MAX,
  getCountReview,
  getCountWork,
  listCountSessions,
  type CountQueryParams,
  type CountReview,
  type CountReviewLine,
  type CountSessionStatus,
  type CountSessionSummary,
  type CountWork,
  type CountWorkLine,
} from "./count-queries.ts";
// Akış ana ekranı "Görevlerim" özeti (T-988): bölüm başına açık/bugün biten iş ve kalem. Salt okuma. `getWorkSummaryAt` (zaman enjeksiyonu) testler içindir ve burada YOKTUR.
export { getBoard, type Board, type BoardBuy, type BoardOrder, type BoardPerson, type BoardTask, type BoardTurn } from "./board.ts";
export { WORK_SECTIONS, getWorkSummary, type WorkSection, type WorkSectionKey, type WorkSummary } from "./work-summary.ts";
export {
  PROBLEM_REASONS,
  WORK_SUBJECT_KINDS,
  listOpenProblems,
  reportProblem,
  resolveProblem,
  setWorkPriority,
  updateWorkShift,
  type OpenProblemView,
  type ProblemReason,
  type ReportProblemInput,
  type SetWorkPriorityInput,
  type WorkSubjectKind,
} from "./work-signals.ts";
// Kısmi sevk ve müşteri iadesi (T-308). `planShipment`/`isShippableReservation` (shipping.ts) ve iade saf yardımcıları iç/test amaçlıdır: burada YOKTUR.
export { shipOrder, type ShipLineInput, type ShipOrderInput } from "./shipping.ts";
export { createCustomerReturn, type CreateCustomerReturnInput } from "./returns.ts";
// Rehberli saha akışı: görev adım ilerlemesi (T-293; ADR-025). Stok değiştirmez; Kaydet `putaway`'i aynı istemci anahtarıyla çağırır. `parseRecordStepInput`/`plainDecimal` saf yardımcılardır (birim testi) ve burada YOKTUR.
export {
  GUIDED_TASK_KINDS,
  RECORDABLE_STEPS,
  SCAN_CODE_MAX,
  TASK_PROGRESS_STEPS,
  beginSave,
  getTaskProgress,
  nextTaskFor,
  recordTaskStep,
  resetTaskProgress,
  savePutawayTask,
  type NextTask,
  type RecordStepResult,
  type RecordableStep,
  type StepRejectionReason,
  type TaskProgressCallParams,
  type TaskProgressStep,
  type TaskProgressView,
} from "./task-progress.ts";
export { transferBetweenWarehouses, type WarehouseTransferInput } from "./warehouse-transfer.ts";
export { scaleRecipeQuantity, createProductionRecipe, getProductionRecipe, listProductionRecipes, produceFromRecipe, type CreateRecipeInput, type ProduceInput } from "./production.ts";
export { listShippingOrders, getShippingOrder, previewShippingPick } from "./shipping-queries.ts";
// Physical package receipt commands and authorized metadata (T-933).
export { preparePackageReceipt, postPackageReceipt, type PreparePackageReceiptInput, type PostPackageReceiptInput } from "./package-receiving.ts";
export { getPackageReceipt, getReceiptPackage, resolvePackageQr, type PackageReceiptView, type ReceiptPackageView } from "./package-receiving-queries.ts";

// T-942: whole physical-package movement commands.
export { approvePackageQuality, putawayPackage, type PackageMovementInput, type PutawayPackageInput } from "./package-movement.ts";

export { getCurrentPackage, resolveCurrentPackageQr, type CurrentPackageDto } from "./package-movement-queries.ts";

export { transferPackage, type PackageTransferInput } from "./package-transfer.ts";

export { previewPackageProduction, preparePackageProduction, postPackageProduction, getPackageProductionBatch, type ProducePackageInput, type PostPackageProductionInput, type PackageProductionPreview, type PackageProductionBatchView, type ProductionPackageView } from "./production.ts";
export { resolveFieldScan, FIELD_SCAN_CODE_MAX, type FieldScanResult, type FieldScanReceipt } from "./field-scan.ts";
// T-977: saha toplama / sayım okumaları (salt okuma): toplama kartı ve OKUT iş yönlendirmesi.
export { findFieldWork, getPickWork, type FieldWork, type FieldWorkTask, type PickWork } from "./field-work.ts";
