import { MediaError } from '@hadialmarzooq/agent-media-core';
import type { FfmpegCapabilities } from '@hadialmarzooq/agent-media-core';

import type { FfmpegOptions } from './inspect.js';
import { runProcess } from './process.js';

export async function getCapabilities(options: FfmpegOptions = {}): Promise<FfmpegCapabilities> {
  try {
    const [version, encoders, filters, hardware] = await Promise.all([
      runProcess(options.ffmpegPath ?? 'ffmpeg', ['-version'], options.timeoutMs),
      runProcess(options.ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-encoders'], options.timeoutMs),
      runProcess(options.ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-filters'], options.timeoutMs),
      runProcess(options.ffmpegPath ?? 'ffmpeg', ['-hide_banner', '-hwaccels'], options.timeoutMs),
    ]);
    if ([version, encoders, filters, hardware].some((result) => result.exitCode !== 0)) {
      throw new Error('FFmpeg returned a non-zero exit code.');
    }
    const versionLine = version.stdout.split('\n')[0] ?? '';
    const match = /ffmpeg version\s+([^\s]+)/i.exec(versionLine);
    return {
      ffmpegVersion: match?.[1] ?? 'unknown',
      encoders: {
        h264: hasCapability(encoders.stdout, /\b(?:libx264|h264_videotoolbox|h264_nvenc)\b/),
        hevc: hasCapability(encoders.stdout, /\b(?:libx265|hevc_videotoolbox|hevc_nvenc)\b/),
        av1: hasCapability(encoders.stdout, /\b(?:libaom-av1|libsvtav1|av1_nvenc)\b/),
        aac: hasCapability(encoders.stdout, /\baac\b/),
      },
      hardwareAcceleration: hardware.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('Hardware acceleration')),
      filters: {
        scale: hasCapability(filters.stdout, /\bscale\b/),
        crop: hasCapability(filters.stdout, /\bcrop\b/),
        concat: hasCapability(filters.stdout, /\bconcat\b/),
        subtitles: hasCapability(filters.stdout, /\bsubtitles\b/),
      },
    };
  } catch (error) {
    throw new MediaError({
      code: 'FFMPEG_NOT_FOUND',
      message: 'FFmpeg capabilities could not be detected.',
      context: { executable: options.ffmpegPath ?? 'ffmpeg' },
      suggestedActions: ['Install FFmpeg and ensure ffmpeg is on PATH.'],
      debug: { backend: 'ffmpeg', stderr: error instanceof Error ? error.message : String(error) },
    });
  }
}

function hasCapability(output: string, pattern: RegExp): boolean {
  return pattern.test(output);
}
