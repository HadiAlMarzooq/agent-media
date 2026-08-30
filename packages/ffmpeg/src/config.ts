import { MediaError } from '@hadialmarzooq/agent-media-core';

import type { FfmpegOptions } from './inspect.js';

/**
 * Probing reads a header and returns; a probe that has not answered in half a minute is stuck.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

/**
 * Encoding is not probing. A ten-minute 1080p source takes minutes of real work, so the execution
 * budget is generous by default and cancellation — which is immediate and leaves no partial file —
 * is the intended way to stop a run early.
 */
export const DEFAULT_EXECUTION_TIMEOUT_MS = 1_800_000;

/**
 * Limits the operator sets, not the caller. On a server these come from the environment, so the
 * model driving the tools cannot widen them by choosing different arguments.
 *
 * - `AGENT_MEDIA_TIMEOUT_MS` caps how long any single FFmpeg run may take.
 * - `AGENT_MEDIA_ALLOWED_OUTPUT_DIR` confines every write to one directory tree.
 * - `AGENT_MEDIA_FFMPEG_PATH` / `AGENT_MEDIA_FFPROBE_PATH` locate binaries that are not on PATH.
 */
export interface OperatorLimits extends FfmpegOptions {
  allowedOutputDirectory?: string;
}

export function operatorLimits(env: NodeJS.ProcessEnv = process.env): OperatorLimits {
  const limits: OperatorLimits = {};
  const timeout = env.AGENT_MEDIA_TIMEOUT_MS;
  if (timeout !== undefined && timeout.trim() !== '') {
    const parsed = Number(timeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new MediaError({
        code: 'INVALID_PLAN',
        message: 'AGENT_MEDIA_TIMEOUT_MS must be a positive number of milliseconds.',
        context: { value: timeout },
        suggestedActions: ['Set AGENT_MEDIA_TIMEOUT_MS to a positive integer, or unset it.'],
      });
    }
    limits.timeoutMs = parsed;
  }
  const directory = env.AGENT_MEDIA_ALLOWED_OUTPUT_DIR;
  if (directory !== undefined && directory.trim() !== '') {
    limits.allowedOutputDirectory = directory;
  }
  const ffmpegPath = env.AGENT_MEDIA_FFMPEG_PATH;
  if (ffmpegPath !== undefined && ffmpegPath.trim() !== '') limits.ffmpegPath = ffmpegPath;
  const ffprobePath = env.AGENT_MEDIA_FFPROBE_PATH;
  if (ffprobePath !== undefined && ffprobePath.trim() !== '') limits.ffprobePath = ffprobePath;
  return limits;
}
