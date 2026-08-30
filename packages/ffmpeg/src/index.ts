export { getCapabilities } from './capabilities.js';
export { compilePlan, extensionForPlan } from './compiler.js';
export type { CompiledOperation } from './compiler.js';
export { executePlan } from './executor.js';
export type { ExecuteOptions, ExecutionResult } from './executor.js';
export { inspectMedia } from './inspect.js';
export type { FfmpegOptions } from './inspect.js';
export type { MediaProgress, MediaProgressPhase, ProgressCallback } from './progress.js';
export {
  makeVertical,
  optimizeForWeb,
  normalize,
  extractAudio,
  extractFrame,
} from './workflows.js';
export type {
  WorkflowOptions,
  MakeVerticalOptions,
  OptimizeForWebOptions,
  NormalizeOptions,
  ExtractAudioOptions,
  ExtractFrameOptions,
  WorkflowResult,
} from './workflows.js';
