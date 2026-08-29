import { access, constants } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { MediaError } from '@agent-media/core';
import type { MediaMetadata, MediaPlan } from '@agent-media/core';

import { compilePlan, type CompiledOperation } from './compiler.js';
import type { FfmpegOptions } from './inspect.js';
import { runProcess } from './process.js';

export interface ExecuteOptions extends FfmpegOptions {
  output: string;
  sourceMetadata: MediaMetadata;
  overwrite?: boolean;
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
  if (!options.overwrite && (await exists(output))) {
    throw new MediaError({
      code: 'OUTPUT_EXISTS',
      message: 'The output path already exists.',
      context: { output },
      suggestedActions: ['Choose a different output path or explicitly enable overwrite.'],
    });
  }
  const operation = compilePlan(plan, options.sourceMetadata, output);
  const result = await runProcess(
    options.ffmpegPath ?? operation.executable,
    operation.args,
    options.timeoutMs,
  );
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
