import type { MediaMetadata, VerificationCheck } from '@hadialmarzooq/agent-media-core';

import { DEFAULT_EXECUTION_TIMEOUT_MS } from './config.js';
import { runProcess } from './process.js';
import type { FfmpegOptions } from './inspect.js';

export interface BlackFrameOptions {
  /** Shortest run of black frames worth reporting. Defaults to 0.5s. */
  minDurationSeconds?: number;
}

export interface SilenceOptions {
  /** Loudness below this threshold counts as silence. Defaults to -50dB. */
  thresholdDb?: number;
  /** Shortest run of silence worth reporting. Defaults to 1s. */
  minDurationSeconds?: number;
}

export interface FreezeOptions {
  /** Shortest run of identical frames worth reporting. Defaults to 2s. */
  minDurationSeconds?: number;
}

/**
 * Content checks that look past container metadata at what the output actually contains.
 * Each entry is opt-in: `true` accepts the defaults, an object tunes them.
 */
export interface ContentCheckOptions {
  blackFrames?: boolean | BlackFrameOptions;
  silence?: boolean | SilenceOptions;
  freeze?: boolean | FreezeOptions;
  /** Decode the whole output and confirm every expected stream is present and playable. */
  completeness?: boolean;
}

/** Names of the checks this module can contribute, for `warnOnly` lists. */
export const contentCheckNames = ['blackFrames', 'silence', 'freeze', 'completeness'] as const;

const DEFAULT_BLACK_SECONDS = 0.5;
const DEFAULT_SILENCE_DB = -50;
const DEFAULT_SILENCE_SECONDS = 1;
const DEFAULT_FREEZE_SECONDS = 2;

/**
 * Decode the output once and report what the picture and sound actually contain: fully black
 * stretches, silence, frozen frames, and whether every expected stream decodes end to end.
 * Metadata verification cannot see any of this — a correctly sized, correctly encoded file can
 * still be six seconds of black.
 */
export async function analyzeContent(
  output: MediaMetadata,
  options: ContentCheckOptions,
  ffmpegOptions: FfmpegOptions = {},
): Promise<Record<string, VerificationCheck>> {
  const wantsBlack = options.blackFrames !== undefined && options.blackFrames !== false;
  const wantsFreeze = options.freeze !== undefined && options.freeze !== false;
  const wantsSilence = options.silence !== undefined && options.silence !== false;
  const wantsCompleteness = options.completeness === true;
  if (!wantsBlack && !wantsFreeze && !wantsSilence && !wantsCompleteness) return {};

  const hasVideo = output.video !== undefined;
  const hasAudio = output.audio.present;
  const videoFilters: string[] = [];
  if (wantsBlack && hasVideo) {
    videoFilters.push(
      `blackdetect=d=${settings(options.blackFrames, 'minDurationSeconds', DEFAULT_BLACK_SECONDS)}:pix_th=0.10`,
    );
  }
  if (wantsFreeze && hasVideo) {
    videoFilters.push(
      `freezedetect=n=-60dB:d=${settings(options.freeze, 'minDurationSeconds', DEFAULT_FREEZE_SECONDS)}`,
    );
  }
  const audioFilters: string[] = [];
  if (wantsSilence && hasAudio) {
    const threshold = settings(options.silence, 'thresholdDb', DEFAULT_SILENCE_DB);
    const duration = settings(options.silence, 'minDurationSeconds', DEFAULT_SILENCE_SECONDS);
    audioFilters.push(`silencedetect=n=${threshold}dB:d=${duration}`);
  }

  const args = ['-hide_banner', '-nostdin', '-i', output.path];
  if (videoFilters.length > 0) args.push('-vf', videoFilters.join(','));
  if (audioFilters.length > 0) args.push('-af', audioFilters.join(','));
  args.push('-f', 'null', '-');

  const result = await runProcess(ffmpegOptions.ffmpegPath ?? 'ffmpeg', args, {
    timeoutMs: ffmpegOptions.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
  });
  const stderr = result.stderr;
  const checks: Record<string, VerificationCheck> = {};

  if (wantsBlack) {
    checks.blackFrames = hasVideo
      ? report(
          !/black_start/.test(stderr),
          'no fully black stretches',
          describeBlack(stderr),
          'Output contains fully black video.',
        )
      : skipped('no video stream to inspect for black frames');
  }
  if (wantsFreeze) {
    checks.freeze = hasVideo
      ? report(
          !/freeze_start/.test(stderr),
          'no frozen stretches',
          /freeze_start/.test(stderr) ? 'frozen frames detected' : 'none',
          'Output contains frozen video.',
        )
      : skipped('no video stream to inspect for frozen frames');
  }
  if (wantsSilence) {
    checks.silence = hasAudio
      ? report(
          !/silence_start/.test(stderr),
          'no silent stretches',
          describeSilence(stderr),
          'Output contains silent audio.',
        )
      : skipped('no audio stream to inspect for silence');
  }
  if (wantsCompleteness) {
    const decodeErrors = decodeErrorLines(stderr);
    const expected = [hasVideo ? 'video' : undefined, hasAudio ? 'audio' : undefined].filter(
      Boolean,
    );
    checks.completeness = report(
      result.exitCode === 0 && decodeErrors.length === 0 && expected.length > 0,
      `every expected stream (${expected.join(', ') || 'none'}) decodes end to end`,
      decodeErrors.length > 0 ? decodeErrors.slice(0, 3).join(' | ') : `exit ${result.exitCode}`,
      'Output did not decode cleanly from start to finish.',
    );
  }
  return checks;
}

function settings<T extends object, K extends keyof T>(
  option: boolean | T | undefined,
  key: K,
  fallback: number,
): number {
  if (typeof option === 'object' && option[key] !== undefined) return option[key] as number;
  return fallback;
}

function report(
  passed: boolean,
  expected: string,
  actual: string,
  failureMessage: string,
): VerificationCheck {
  return {
    passed,
    expected,
    actual,
    message: passed ? 'Constraint satisfied.' : failureMessage,
  };
}

function skipped(reason: string): VerificationCheck {
  return { passed: true, expected: reason, actual: 'skipped', message: 'Constraint satisfied.' };
}

function describeBlack(stderr: string): string {
  const matches = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)];
  if (matches.length === 0) return 'none';
  return matches.map((match) => `${match[1]}s-${match[2]}s`).join(', ');
}

function describeSilence(stderr: string): string {
  const matches = [...stderr.matchAll(/silence_start: ([\d.-]+)/g)];
  if (matches.length === 0) return 'none';
  return matches.map((match) => `from ${match[1]}s`).join(', ');
}

function decodeErrorLines(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => /error|invalid data|corrupt|could not/i.test(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
