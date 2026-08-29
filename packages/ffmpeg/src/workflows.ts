import { MediaError, planMedia, serializePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';
import type { MediaMetadata, MediaPlan, VerificationReport } from '@hadialmarzooq/agent-media-core';

import { executePlan, type ExecuteOptions } from './executor.js';
import { getCapabilities } from './capabilities.js';
import { inspectMedia, type FfmpegOptions } from './inspect.js';
import { safelyNotify, type ProgressCallback } from './progress.js';

export interface MakeVerticalOptions extends FfmpegOptions {
  input: string;
  output: string;
  width?: number;
  height?: number;
  trimStartSeconds?: number;
  durationSeconds?: number;
  maxSizeMB?: number;
  audio?: 'preserve' | 'remove';
  overwrite?: boolean;
  allowedOutputDirectory?: string;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export interface MakeVerticalResult {
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
export async function makeVertical(options: MakeVerticalOptions): Promise<MakeVerticalResult> {
  const dimensions = verticalDimensions(options.width, options.height);
  emit(options.onProgress, 'inspecting', 0, 'Inspecting the source media.');
  const source = await inspectMedia(options.input, ffmpegOptions(options));
  emit(options.onProgress, 'inspecting', 10, 'Source inspection completed.');

  emit(options.onProgress, 'planning', 15, 'Creating a semantic vertical media plan.');
  const plan = planMedia({
    source,
    capabilities: await getCapabilities(ffmpegOptions(options)),
    goals: {
      aspectRatio: '9:16',
      width: dimensions.width,
      height: dimensions.height,
      compatibility: 'high',
      ...(options.trimStartSeconds === undefined
        ? {}
        : { trimStartSeconds: options.trimStartSeconds }),
      ...(options.durationSeconds === undefined
        ? {}
        : { durationSeconds: options.durationSeconds }),
      ...(options.maxSizeMB === undefined ? {} : { maxSizeMB: options.maxSizeMB }),
      ...(options.audio === undefined
        ? source.audio.present
          ? { audio: 'preserve' as const }
          : {}
        : { audio: options.audio }),
    },
  });
  const serializedPlan = serializePlan(plan);
  emit(options.onProgress, 'planning', 20, 'Vertical media plan is ready.');

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
      message: 'The vertical workflow completed, but the output did not satisfy its plan.',
      context: { output: execution.output, verification },
      suggestedActions: ['Inspect the failed checks, adjust the semantic goals, and retry.'],
    });
  }
  emit(options.onProgress, 'completed', 100, 'Vertical media is verified and ready.');
  return { source, plan, serializedPlan, output, verification };
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

function emit(
  onProgress: ProgressCallback | undefined,
  phase: 'inspecting' | 'planning' | 'verifying' | 'completed',
  percent: number,
  message: string,
): void {
  safelyNotify(onProgress, { phase, percent, message });
}
