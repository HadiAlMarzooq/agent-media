import { access, constants } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { MediaError } from '@hadialmarzooq/agent-media-core';
import type { MediaMetadata, MediaPlan } from '@hadialmarzooq/agent-media-core';

import { compilePlan, type CompiledOperation } from './compiler.js';
import type { FfmpegOptions } from './inspect.js';
import { runProcess } from './process.js';

export interface ExecuteOptions extends FfmpegOptions {
  output: string;
  sourceMetadata: MediaMetadata;
  overwrite?: boolean;
  allowedOutputDirectory?: string;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  output: string;
  operation: CompiledOperation;
}

export async function executePlan(
  plan: MediaPlan,
  options: ExecuteOptions,
): Promise<ExecutionResult> {
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
  const operation = compilePlan(plan, options.sourceMetadata, output);
  const result = await runProcess(options.ffmpegPath ?? operation.executable, operation.args, {
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (result.aborted) {
    throw new MediaError({
      code: 'OPERATION_CANCELLED',
      message: 'Media execution was cancelled.',
      context: { input: plan.source.path, output },
      suggestedActions: ['Create a new execution request when ready.'],
    });
  }
  if (result.timedOut) {
    throw new MediaError({
      code: 'OPERATION_TIMEOUT',
      message: 'Media execution exceeded its configured timeout.',
      context: { input: plan.source.path, output, timeoutMs: options.timeoutMs ?? 30_000 },
      suggestedActions: ['Use a longer timeout or a smaller media operation.'],
      debug: { backend: 'ffmpeg', stderr: result.stderr },
    });
  }
  if (result.exitCode !== 0) {
    throw new MediaError({
      code: 'EXECUTION_FAILED',
      message: 'FFmpeg could not execute the media plan.',
      context: { input: plan.source.path, output, directory: dirname(output) },
      suggestedActions: ['Inspect the source and plan, then retry with a supported target.'],
      debug: { backend: 'ffmpeg', stderr: result.stderr },
    });
  }
  return { output, operation };
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
