import { access, constants, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';

import {
  MediaError,
  buildReceipt,
  parseReceipt,
  receiptMatches,
  streamDifferences,
  validatePlan,
  verifyMedia,
} from '@hadialmarzooq/agent-media-core';
import type {
  ExecutionReceipt,
  MediaMetadata,
  MediaPlan,
  SourceFingerprint,
  VerificationReport,
} from '@hadialmarzooq/agent-media-core';

import { compilePlan, extensionForPlan, type CompiledOperation } from './compiler.js';
import { analyzeContent, type ContentCheckOptions } from './content.js';
import { DEFAULT_EXECUTION_TIMEOUT_MS } from './config.js';
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
  /** Write a durable receipt to `${output}.receipt.json` after execution. */
  writeReceipt?: boolean;
  /**
   * Idempotent resume: if a passing receipt exists for the same plan and
   * unchanged source, skip re-execution and return the recorded output.
   */
  resume?: boolean;
  /** Content checks to run against the output alongside metadata verification. */
  contentChecks?: ContentCheckOptions;
  /** Check names that warn instead of failing the report. */
  warnOnly?: string[];
}

export interface ExecutionResult {
  output: string;
  operation: CompiledOperation;
  receipt?: ExecutionReceipt;
  resumed?: boolean;
  /** Inspected output metadata, so callers do not have to probe the same file again. */
  outputMetadata?: MediaMetadata;
  /** The verification recorded in the receipt, including any content checks. */
  verification?: VerificationReport;
}

export async function executePlan(
  planInput: MediaPlan,
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  const plan = validatePlan(planInput);
  const output = resolve(options.output);
  const release = await acquireOutputLock(output);
  try {
    return await executePlanInternal(plan, options, output);
  } catch (error) {
    // A failed run is still a fact worth recording: the receipt says which plan was attempted
    // against which source and how it failed, so a resume can tell "never ran" from "ran and
    // did not satisfy the plan".
    if (options.writeReceipt) await writeFailureReceipt(plan, options, output, error);
    throw error;
  } finally {
    releaseOutputLock(output, release);
  }
}

async function writeFailureReceipt(
  plan: MediaPlan,
  options: ExecuteOptions,
  output: string,
  error: unknown,
): Promise<void> {
  try {
    const source =
      options.sourceMetadata ??
      (await inspectMedia(plan.source.path, {
        ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }));
    const failure =
      error instanceof MediaError
        ? { code: error.code, message: error.message }
        : {
            code: 'UNEXPECTED_ERROR',
            message: error instanceof Error ? error.message : String(error),
          };
    const receipt = buildReceipt({
      plan,
      source: fingerprintOf(source),
      backend: { name: 'ffmpeg' },
      output: { path: output, sizeBytes: 0 },
      executedSteps: [],
      verification: {
        passed: false,
        checks: {},
        failures: [`${failure.code}: ${failure.message}`],
        warnings: [],
      },
      failure,
    });
    await writeFile(receiptPath(output), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  } catch {
    // Never let receipt bookkeeping replace the original failure.
  }
}

export interface ResumeOptions extends FfmpegOptions {
  /** Where the output should land. Defaults to the path recorded in the receipt. */
  output?: string;
  overwrite?: boolean;
  writeReceipt?: boolean;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  contentChecks?: ContentCheckOptions;
  warnOnly?: string[];
}

/**
 * Continue from a saved receipt: skip the work when the recorded output still satisfies the same
 * plan against an unchanged source, and re-execute the plan when it does not.
 */
export async function resumeFromReceipt(
  receipt: ExecutionReceipt,
  options: ResumeOptions = {},
): Promise<ExecutionResult> {
  return executePlan(receipt.plan, {
    output: options.output ?? receipt.output.path,
    resume: true,
    writeReceipt: options.writeReceipt ?? true,
    ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
    ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    ...(options.contentChecks === undefined ? {} : { contentChecks: options.contentChecks }),
    ...(options.warnOnly === undefined ? {} : { warnOnly: options.warnOnly }),
  });
}

async function executePlanInternal(
  plan: MediaPlan,
  options: ExecuteOptions,
  output: string,
): Promise<ExecutionResult> {
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
  // A resume run expects the output to be there already, so the existence guard is deferred
  // until the receipt has had its chance to match. It still applies when it does not.
  if (!options.overwrite && !options.resume && (await exists(output))) {
    throw outputExistsError(output);
  }
  const outputDir = dirname(output);
  if (!(await exists(outputDir))) {
    throw new MediaError({
      code: 'OUTPUT_DIR_MISSING',
      message: 'The output directory does not exist.',
      context: { output, directory: outputDir },
      suggestedActions: ['Create the output directory before execution.'],
    });
  }
  const expectedExt = extensionForPlan(plan);
  const actualExt = extname(output);
  if (expectedExt && actualExt && expectedExt !== actualExt) {
    throw new MediaError({
      code: 'OUTPUT_EXTENSION_MISMATCH',
      message: `The output extension "${actualExt}" does not match the plan's expected "${expectedExt}".`,
      context: { output, expectedExtension: expectedExt, actualExtension: actualExt },
      suggestedActions: [`Use a "${expectedExt}" output extension, or adjust the plan.`],
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
  if (options.resume) {
    const resumed = await tryResume(plan, sourceMetadata, output);
    if (resumed !== undefined) return resumed;
    if (!options.overwrite && (await exists(output))) throw outputExistsError(output);
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
        timeoutMs: options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
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
      context: {
        input: plan.source.path,
        output,
        timeoutMs: options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
      },
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
  const executedOutput = await inspectMedia(output, {
    ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const contentChecks =
    options.contentChecks === undefined
      ? {}
      : await analyzeContent(executedOutput, options.contentChecks, {
          ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        });
  const verification = verifyMedia(executedOutput, plan.expectations, {
    customChecks: [() => contentChecks],
    ...(options.warnOnly === undefined ? {} : { warnOnly: options.warnOnly }),
  });
  const receipt = buildReceipt({
    plan,
    source: fingerprintOf(sourceMetadata),
    backend: { name: 'ffmpeg' },
    output: {
      path: output,
      sizeBytes: executedOutput.sizeBytes,
      ...(executedOutput.durationSeconds === undefined
        ? {}
        : { durationSeconds: executedOutput.durationSeconds }),
    },
    executedSteps: plan.steps.map((step) => step.id),
    verification,
  });
  if (options.writeReceipt) {
    await writeFile(receiptPath(output), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  return { output, operation, receipt, outputMetadata: executedOutput, verification };
}

async function tryResume(
  plan: MediaPlan,
  sourceMetadata: MediaMetadata,
  output: string,
): Promise<ExecutionResult | undefined> {
  const receiptFile = receiptPath(output);
  if (!(await exists(receiptFile))) return undefined;
  if (!(await exists(output))) return undefined;
  let receipt: ExecutionReceipt;
  try {
    receipt = parseReceipt(await readFile(receiptFile, 'utf8'));
  } catch {
    return undefined;
  }
  if (!receiptMatches(receipt, plan, fingerprintOf(sourceMetadata))) return undefined;
  const operation = compilePlan(plan, sourceMetadata, output);
  return { output, operation, receipt, resumed: true };
}

function outputExistsError(output: string): MediaError {
  return new MediaError({
    code: 'OUTPUT_EXISTS',
    message: 'The output path already exists.',
    context: { output },
    suggestedActions: ['Choose a different output path or explicitly enable overwrite.'],
  });
}

function receiptPath(output: string): string {
  return `${output}.receipt.json`;
}

function fingerprintOf(source: MediaMetadata): SourceFingerprint {
  return {
    path: source.path,
    sizeBytes: source.sizeBytes,
    ...(source.durationSeconds === undefined ? {} : { durationSeconds: source.durationSeconds }),
    ...(source.container === undefined ? {} : { container: source.container }),
    ...(source.video?.codec === undefined ? {} : { videoCodec: source.video.codec }),
  };
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

const outputLocks = new Map<string, Promise<void>>();

async function acquireOutputLock(output: string): Promise<() => void> {
  const prev = outputLocks.get(output) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  outputLocks.set(
    output,
    prev.then(() => next),
  );
  await prev;
  return release;
}

function releaseOutputLock(output: string, release: () => void): void {
  release();
  outputLocks.delete(output);
}
