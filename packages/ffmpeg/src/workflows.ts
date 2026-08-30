import { MediaError, planMedia, serializePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';
import type { MediaMetadata, MediaPlan, VerificationReport } from '@hadialmarzooq/agent-media-core';

import { executePlan, type ExecuteOptions } from './executor.js';
import { getCapabilities } from './capabilities.js';
import { inspectMedia, type FfmpegOptions } from './inspect.js';
import { safelyNotify, type ProgressCallback } from './progress.js';

export interface WorkflowOptions extends FfmpegOptions {
  input: string;
  output: string;
  overwrite?: boolean;
  allowedOutputDirectory?: string;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export interface MakeVerticalOptions extends WorkflowOptions {
  width?: number;
  height?: number;
  trimStartSeconds?: number;
  durationSeconds?: number;
  maxSizeMB?: number;
  audio?: 'preserve' | 'remove';
}

export interface OptimizeForWebOptions extends WorkflowOptions {
  trimStartSeconds?: number;
  durationSeconds?: number;
  maxSizeMB?: number;
  audio?: 'preserve' | 'remove';
  quality?: 'high' | 'balanced' | 'small';
}

export interface NormalizeOptions extends WorkflowOptions {
  trimStartSeconds?: number;
  durationSeconds?: number;
  audio?: 'preserve' | 'remove';
}

export interface ExtractAudioOptions extends WorkflowOptions {
  format?: 'm4a' | 'mp3' | 'wav';
  trimStartSeconds?: number;
  durationSeconds?: number;
}

export interface ExtractFrameOptions extends WorkflowOptions {
  atSeconds?: number;
  format?: 'jpg' | 'png';
}

export interface WorkflowResult {
  source: MediaMetadata;
  plan: MediaPlan;
  serializedPlan: string;
  output: MediaMetadata;
  verification: VerificationReport;
}

/**
 * Inspect, plan, execute, and verify a high-compatibility 9:16 video in one semantic workflow.
 * The returned Media IR remains portable and replayable; this convenience API does not bypass it.
 */
export async function makeVertical(options: MakeVerticalOptions): Promise<WorkflowResult> {
  const dimensions = verticalDimensions(options.width, options.height);
  const source = await inspectPhase(options, 'vertical media');
  const plan = await planningPhase(options, 'vertical media', source, {
    aspectRatio: '9:16',
    width: dimensions.width,
    height: dimensions.height,
    compatibility: 'high',
    ...(options.trimStartSeconds === undefined ? {} : { trimStartSeconds: options.trimStartSeconds }),
    ...(options.durationSeconds === undefined ? {} : { durationSeconds: options.durationSeconds }),
    ...(options.maxSizeMB === undefined ? {} : { maxSizeMB: options.maxSizeMB }),
    ...audioGoal(options, source),
  });
  return executeAndVerify(options, source, plan, 'Vertical media is verified and ready.');
}

/**
 * Inspect, plan, execute, and verify a web-optimized video: balanced quality,
 * H.264/yuv420p, faststart, and an optional maximum file size.
 */
export async function optimizeForWeb(options: OptimizeForWebOptions): Promise<WorkflowResult> {
  const source = await inspectPhase(options, 'web-optimized media');
  const plan = await planningPhase(options, 'web-optimized media', source, {
    compatibility: 'high',
    quality: options.quality ?? 'balanced',
    ...(options.trimStartSeconds === undefined ? {} : { trimStartSeconds: options.trimStartSeconds }),
    ...(options.durationSeconds === undefined ? {} : { durationSeconds: options.durationSeconds }),
    ...(options.maxSizeMB === undefined ? {} : { maxSizeMB: options.maxSizeMB }),
    ...audioGoal(options, source),
  });
  return executeAndVerify(options, source, plan, 'Web-optimized media is verified and ready.');
}

/**
 * Inspect, plan, execute, and verify a normalized high-compatibility copy without
 * changing dimensions or aspect ratio. Ensures H.264, yuv420p, and faststart.
 */
export async function normalize(options: NormalizeOptions): Promise<WorkflowResult> {
  const source = await inspectPhase(options, 'normalized media');
  const plan = await planningPhase(options, 'normalized media', source, {
    compatibility: 'high',
    ...(options.trimStartSeconds === undefined ? {} : { trimStartSeconds: options.trimStartSeconds }),
    ...(options.durationSeconds === undefined ? {} : { durationSeconds: options.durationSeconds }),
    ...audioGoal(options, source),
  });
  return executeAndVerify(options, source, plan, 'Normalized media is verified and ready.');
}

/**
 * Inspect, plan, execute, and verify audio extraction from any media source.
 */
export async function extractAudio(options: ExtractAudioOptions): Promise<WorkflowResult> {
  const source = await inspectPhase(options, 'audio extraction');
  const plan = await planningPhase(options, 'audio extraction', source, {
    extractAudio: { format: options.format ?? 'm4a' },
    ...(options.trimStartSeconds === undefined ? {} : { trimStartSeconds: options.trimStartSeconds }),
    ...(options.durationSeconds === undefined ? {} : { durationSeconds: options.durationSeconds }),
  });
  return executeAndVerify(options, source, plan, 'Audio extraction is verified and ready.');
}

/**
 * Inspect, plan, execute, and verify a still frame extraction from a video source.
 */
export async function extractFrame(options: ExtractFrameOptions): Promise<WorkflowResult> {
  const source = await inspectPhase(options, 'frame extraction');
  const plan = await planningPhase(options, 'frame extraction', source, {
    extractFrame: {
      atSeconds: options.atSeconds ?? 0,
      format: options.format ?? 'jpg',
    },
  });
  return executeAndVerify(options, source, plan, 'Frame extraction is verified and ready.');
}

function verticalDimensions(
  width: number | undefined,
  height: number | undefined,
): { width: number; height: number } {
  if ((width === undefined) !== (height === undefined)) {
    throw new MediaError({
      code: 'INVALID_PLAN',
      message: 'Custom vertical dimensions require both width and height.',
      suggestedActions: ['Provide both dimensions or use the default 1080x1920 output.'],
    });
  }
  return { width: width ?? 1080, height: height ?? 1920 };
}

function ffmpegOptions(options: FfmpegOptions): FfmpegOptions {
  return {
    ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
    ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
}

function audioGoal(
  options: { audio?: 'preserve' | 'remove' },
  source: MediaMetadata,
): { audio?: 'preserve' | 'remove' } {
  if (options.audio !== undefined) return { audio: options.audio };
  return source.audio.present ? { audio: 'preserve' } : {};
}

async function inspectPhase(
  options: WorkflowOptions,
  label: string,
): Promise<MediaMetadata> {
  emit(options.onProgress, 'inspecting', 0, `Inspecting the source media for ${label}.`);
  const source = await inspectMedia(options.input, ffmpegOptions(options));
  emit(options.onProgress, 'inspecting', 10, 'Source inspection completed.');
  return source;
}

async function planningPhase(
  options: WorkflowOptions,
  label: string,
  source: MediaMetadata,
  goals: Record<string, unknown>,
): Promise<MediaPlan> {
  emit(options.onProgress, 'planning', 15, `Creating a semantic plan for ${label}.`);
  const plan = planMedia({
    source,
    capabilities: await getCapabilities(ffmpegOptions(options)),
    goals: goals as never,
  });
  const serializedPlan = serializePlan(plan);
  emit(options.onProgress, 'planning', 20, `${label} plan is ready.`);
  return plan;
}

async function executeAndVerify(
  options: WorkflowOptions,
  source: MediaMetadata,
  plan: MediaPlan,
  completionMessage: string,
): Promise<WorkflowResult> {
  const executeOptions: ExecuteOptions = {
    output: options.output,
    sourceMetadata: source,
    ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
    ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    ...(options.allowedOutputDirectory === undefined
      ? {}
      : { allowedOutputDirectory: options.allowedOutputDirectory }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onProgress: (progress) => {
      const percent = 20 + Math.round(progress.percent * 0.7);
      safelyNotify(options.onProgress, { ...progress, percent });
    },
  };
  const execution = await executePlan(plan, executeOptions);

  emit(options.onProgress, 'verifying', 92, 'Inspecting and verifying the output.');
  const output = await inspectMedia(execution.output, ffmpegOptions(options));
  const verification = verifyMedia(output, plan.expectations);
  if (!verification.passed) {
    throw new MediaError({
      code: 'VERIFICATION_FAILED',
      message: 'The workflow completed, but the output did not satisfy its plan.',
      context: { output: execution.output, verification },
      suggestedActions: ['Inspect the failed checks, adjust the semantic goals, and retry.'],
    });
  }
  emit(options.onProgress, 'completed', 100, completionMessage);
  const serializedPlan = serializePlan(plan);
  return { source, plan, serializedPlan, output, verification };
}

function emit(
  onProgress: ProgressCallback | undefined,
  phase: 'inspecting' | 'planning' | 'verifying' | 'completed',
  percent: number,
  message: string,
): void {
  safelyNotify(onProgress, { phase, percent, message });
}
