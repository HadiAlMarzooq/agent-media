import { access, constants, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { MediaError, validatePlan } from '@hadialmarzooq/agent-media-core';
import type { MediaMetadata, MediaPlan } from '@hadialmarzooq/agent-media-core';

import { compilePlan, type CompiledOperation } from './compiler.js';
import { inspectMedia, type FfmpegOptions } from './inspect.js';
import { createExecutionProgressReporter, type ProgressCallback } from './progress.js';
import { runProcess } from './process.js';

export interface ExecuteOptions extends FfmpegOptions {
  output: string;
  sourceMetadata?: MediaMetadata;
  overwrite?: boolean;
  allowedOutputDirectory?: string;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export interface ExecutionResult {
  output: string;
  operation: CompiledOperation;
}

export async function executePlan(
  planInput: MediaPlan,
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  const plan = validatePlan(planInput);
  const output = resolve(options.output);
  if (output === resolve(plan.source.path)) {
    throw new MediaError({
      code: 'PATH_NOT_ALLOWED',
      message: 'Output must not overwrite the source path.',
      context: { source: plan.source.path, output },
      suggestedActions: ['Choose a distinct output path.'],
    });
  }
  if (
    options.allowedOutputDirectory !== undefined &&
    !isWithin(output, resolve(options.allowedOutputDirectory))
  ) {
    throw new MediaError({
      code: 'PATH_NOT_ALLOWED',
      message: 'Output is outside the allowed output directory.',
      context: { output, allowedOutputDirectory: resolve(options.allowedOutputDirectory) },
      suggestedActions: ['Choose a path within the configured output directory.'],
    });
  }
  if (!options.overwrite && (await exists(output))) {
    throw new MediaError({
      code: 'OUTPUT_EXISTS',
      message: 'The output path already exists.',
      context: { output },
      suggestedActions: ['Choose a different output path or explicitly enable overwrite.'],
    });
  }
  const sourceMetadata =
    options.sourceMetadata ??
    (await inspectMedia(plan.source.path, {
      ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }));
  if (resolve(sourceMetadata.path) !== resolve(plan.source.path)) {
    throw new MediaError({
      code: 'INVALID_PLAN',
      message: 'Source metadata does not describe the Media Plan source.',
      context: { planSource: plan.source.path, metadataSource: sourceMetadata.path },
      suggestedActions: ['Inspect the planned source and pass that metadata to executePlan.'],
    });
  }
  await preflightConcatenation(plan, sourceMetadata, options);
  const operation = compilePlan(plan, sourceMetadata, output);
  const progress = createExecutionProgressReporter(
    executionDuration(plan, sourceMetadata),
    options.onProgress,
  );
  progress.start();
  let result;
  try {
    result = await runProcess(
      options.ffmpegPath ?? operation.executable,
      progressArgs(operation.args),
      {
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onStdout: progress.write,
      },
    );
  } catch (error) {
    throw new MediaError({
      code: 'FFMPEG_NOT_FOUND',
      message: 'FFmpeg could not be started for plan execution.',
      context: { executable: options.ffmpegPath ?? operation.executable },
      suggestedActions: ['Install FFmpeg and ensure ffmpeg is on PATH.'],
      debug: { backend: 'ffmpeg', stderr: error instanceof Error ? error.message : String(error) },
    });
  }
  if (result.aborted) {
    await removePartialOutput(output);
    throw new MediaError({
      code: 'OPERATION_CANCELLED',
      message: 'Media execution was cancelled.',
      context: { input: plan.source.path, output },
      suggestedActions: ['Create a new execution request when ready.'],
    });
  }
  if (result.timedOut) {
    await removePartialOutput(output);
    throw new MediaError({
      code: 'OPERATION_TIMEOUT',
      message: 'Media execution exceeded its configured timeout.',
      context: { input: plan.source.path, output, timeoutMs: options.timeoutMs ?? 30_000 },
      suggestedActions: ['Use a longer timeout or a smaller media operation.'],
      debug: { backend: 'ffmpeg', stderr: result.stderr },
    });
  }
  if (result.exitCode !== 0) {
    await removePartialOutput(output);
    throw new MediaError({
      code: 'EXECUTION_FAILED',
      message: 'FFmpeg could not execute the media plan.',
      context: { input: plan.source.path, output, directory: dirname(output) },
      suggestedActions: ['Inspect the source and plan, then retry with a supported target.'],
      debug: { backend: 'ffmpeg', stderr: result.stderr },
    });
  }
  progress.complete();
  return { output, operation };
}

function progressArgs(args: readonly string[]): string[] {
  const result = [...args];
  const insertionPoint = result.indexOf('-nostdin') + 1;
  result.splice(insertionPoint, 0, '-progress', 'pipe:1', '-nostats');
  return result;
}

function executionDuration(plan: MediaPlan, source: MediaMetadata): number | undefined {
  if (plan.expectations.durationSeconds !== undefined) return plan.expectations.durationSeconds;
  const trim = plan.steps.find((step) => step.operation === 'trim');
  if (trim?.operation !== 'trim') return source.durationSeconds;
  if (trim.endSeconds !== undefined) return trim.endSeconds - trim.startSeconds;
  return source.durationSeconds === undefined
    ? undefined
    : Math.max(0, source.durationSeconds - trim.startSeconds);
}

async function preflightConcatenation(
  plan: MediaPlan,
  source: MediaMetadata,
  options: ExecuteOptions,
): Promise<void> {
  const concatenate = plan.steps.find((step) => step.operation === 'concatenate');
  if (concatenate?.operation !== 'concatenate') return;

  const metadata = await Promise.all(
    concatenate.inputs.map(async (input, index) => {
      if (index === 0) return source;
      return inspectMedia(input, {
        ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
    }),
  );
  const baseline = metadata[0];
  if (baseline === undefined) return;

  for (const [index, candidate] of metadata.entries()) {
    if (index === 0) continue;
    const incompatibleFields = streamDifferences(baseline, candidate);
    if (incompatibleFields.length === 0) continue;
    throw new MediaError({
      code: 'UNSUPPORTED_INPUT',
      message: 'Concatenation inputs have incompatible stream layouts.',
      context: {
        input: concatenate.inputs[index],
        inputIndex: index,
        incompatibleFields,
      },
      suggestedActions: [
        'Normalize the listed stream properties before concatenation.',
        'Use inputs with matching video and audio stream layouts.',
      ],
    });
  }
}

function streamDifferences(baseline: MediaMetadata, candidate: MediaMetadata): string[] {
  const differences: string[] = [];
  compare(
    differences,
    'video.present',
    baseline.video !== undefined,
    candidate.video !== undefined,
  );
  compare(differences, 'audio.present', baseline.audio.present, candidate.audio.present);
  if (baseline.video !== undefined && candidate.video !== undefined) {
    compare(differences, 'video.width', baseline.video.width, candidate.video.width);
    compare(differences, 'video.height', baseline.video.height, candidate.video.height);
    compare(differences, 'video.fps', baseline.video.fps, candidate.video.fps);
    compare(
      differences,
      'video.pixelFormat',
      baseline.video.pixelFormat,
      candidate.video.pixelFormat,
    );
  }
  if (baseline.audio.present && candidate.audio.present) {
    compare(differences, 'audio.sampleRate', baseline.audio.sampleRate, candidate.audio.sampleRate);
    compare(differences, 'audio.channels', baseline.audio.channels, candidate.audio.channels);
  }
  return differences;
}

function compare(
  differences: string[],
  field: string,
  baseline: unknown,
  candidate: unknown,
): void {
  if (baseline !== candidate) differences.push(field);
}

async function removePartialOutput(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // Preserve the primary execution error; cleanup is best effort.
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isWithin(path: string, directory: string): boolean {
  const pathRelative = relative(directory, path);
  return pathRelative === '' || (!pathRelative.startsWith('..') && !pathRelative.includes('..\\'));
}
