export const CORE_VERSION = '0.0.1';

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
  aspectRatioSchema,
  mediaPlanSchema,
  mediaStepSchema,
  parsePlan,
  serializePlan,
} from './ir.js';
export type { MediaExpectations, MediaPlan, MediaStep } from './ir.js';
export { planMedia } from './planner.js';
export type { MediaGoals, PlanRequest } from './planner.js';
export { verifyMedia } from './verification.js';
export type { VerificationCheck, VerificationReport } from './verification.js';
