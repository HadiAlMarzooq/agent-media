import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { MediaError } from '@hadialmarzooq/agent-media-core';
import type {
  AudioStreamMetadata,
  MediaKind,
  MediaMetadata,
  VideoStreamMetadata,
} from '@hadialmarzooq/agent-media-core';

import { runProcess } from './process.js';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

interface ProbeOutput {
  format?: { format_name?: string; duration?: string };
  streams?: ProbeStream[];
}

export interface FfmpegOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
}

export async function inspectMedia(
  input: string,
  options: FfmpegOptions = {},
): Promise<MediaMetadata> {
  const path = resolve(input);
  let sourceStat: Awaited<ReturnType<typeof stat>>;
  try {
    sourceStat = await stat(path);
  } catch {
    throw new MediaError({
      code: 'UNSUPPORTED_INPUT',
      message: `The input file does not exist: ${basename(input)}.`,
      context: { input: path },
      suggestedActions: ['Check the source path and permissions.'],
    });
  }

  let result;
  try {
    result = await runProcess(
      options.ffprobePath ?? 'ffprobe',
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path],
      options.timeoutMs,
    );
  } catch (error) {
    throw new MediaError({
      code: 'FFMPEG_NOT_FOUND',
      message: 'ffprobe could not be started.',
      context: { executable: options.ffprobePath ?? 'ffprobe' },
      suggestedActions: ['Install FFmpeg and ensure ffprobe is on PATH.'],
      debug: { backend: 'ffmpeg', stderr: error instanceof Error ? error.message : String(error) },
    });
  }
  if (result.exitCode !== 0) {
    throw new MediaError({
      code: 'PROBE_FAILED',
      message: 'ffprobe could not read the input media.',
      context: { input: path },
      suggestedActions: [
        'Run inspect to confirm the file is readable.',
        'Try a supported media container.',
      ],
      debug: { backend: 'ffmpeg', stderr: result.stderr },
    });
  }

  const probe = JSON.parse(result.stdout) as ProbeOutput;
  const streams = probe.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const audioStream = streams.find((stream) => stream.codec_type === 'audio');
  const video = normalizeVideo(videoStream);
  const audio = normalizeAudio(audioStream);
  const kind: MediaKind = video
    ? probe.format?.format_name?.split(',').includes('image2')
      ? 'image'
      : 'video'
    : audio.present
      ? 'audio'
      : 'unknown';

  const durationSeconds = toFiniteNumber(probe.format?.duration);
  return {
    path,
    kind,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(probe.format?.format_name === undefined
      ? {}
      : { container: probe.format.format_name.split(',')[0] }),
    sizeBytes: sourceStat.size,
    ...(video === undefined ? {} : { video }),
    audio,
  };
}

function normalizeVideo(stream: ProbeStream | undefined): VideoStreamMetadata | undefined {
  if (stream?.width === undefined || stream.height === undefined) return undefined;
  const fps = parseFraction(stream.r_frame_rate);
  const rotation = stream.side_data_list?.find((data) => data.rotation !== undefined)?.rotation;
  const tagRotation = stream.tags?.rotate === undefined ? undefined : Number(stream.tags.rotate);
  return {
    width: stream.width,
    height: stream.height,
    aspectRatio: simplifyAspectRatio(stream.width, stream.height),
    ...(fps === undefined ? {} : { fps }),
    ...(stream.codec_name === undefined ? {} : { codec: stream.codec_name }),
    ...(stream.pix_fmt === undefined ? {} : { pixelFormat: stream.pix_fmt }),
    ...(rotation === undefined && tagRotation === undefined
      ? {}
      : { rotationDegrees: Math.round(rotation ?? tagRotation ?? 0) }),
  };
}

function normalizeAudio(stream: ProbeStream | undefined): AudioStreamMetadata {
  if (stream === undefined) return { present: false };
  const sampleRate = toFiniteNumber(stream.sample_rate);
  return {
    present: true,
    ...(stream.codec_name === undefined ? {} : { codec: stream.codec_name }),
    ...(sampleRate === undefined ? {} : { sampleRate }),
    ...(stream.channels === undefined ? {} : { channels: stream.channels }),
  };
}

function parseFraction(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const [numerator, denominator] = value.split('/').map(Number);
  if (
    numerator === undefined ||
    denominator === undefined ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  )
    return undefined;
  return numerator / denominator;
}

function toFiniteNumber(value: string | undefined): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function simplifyAspectRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(left: number, right: number): number {
  return right === 0 ? left : gcd(right, left % right);
}
