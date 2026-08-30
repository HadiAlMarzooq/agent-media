export { MediaError } from './errors.js';
export type { MediaErrorCode, MediaErrorDetails } from './errors.js';
export type {
  AudioStreamMetadata,
  FfmpegCapabilities,
  MediaKind,
  MediaMetadata,
  VideoStreamMetadata,
} from './media.js';
export {
  MEDIA_IR_VERSION,
  aspectRatioSchema,
  mediaPlanSchema,
  mediaStepSchema,
  parsePlan,
  serializePlan,
  validatePlan,
} from './ir.js';
export type { MediaExpectations, MediaPlan, MediaStep } from './ir.js';
export { planMedia } from './planner.js';
export type { MediaGoals, PlanRequest } from './planner.js';
export {
  inspectPlanIssues,
  planConcatenationNormalization,
  repairPlan,
  streamDifferences,
} from './repair.js';
export type {
  ConcatenationNormalization,
  InspectPlanOptions,
  PlanIssue,
  PlanRepair,
  RepairedPlan,
} from './repair.js';
export {
  RECEIPT_VERSION,
  buildReceipt,
  executionReceiptSchema,
  parseReceipt,
  planFingerprint,
  receiptMatches,
  sourceFingerprintSchema,
  validateReceipt,
} from './receipt.js';
export type { BuildReceiptInput, ExecutionReceipt, SourceFingerprint } from './receipt.js';
export { mediaPlanJsonSchema, mediaPlanSchemaId, mediaPlanSchemaVersion } from './schema.js';
export { verifyMedia } from './verification.js';
export type {
  CustomVerificationCheck,
  VerificationCheck,
  VerificationReport,
  VerifyOptions,
} from './verification.js';
