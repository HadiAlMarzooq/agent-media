import { extname } from 'node:path';

import { MediaError } from '@hadialmarzooq/agent-media-core';
import type { MediaMetadata, MediaPlan, MediaStep } from '@hadialmarzooq/agent-media-core';

export interface CompiledOperation {
  executable: string;
  args: string[];
}

/** Compile semantic Media IR into a deterministic FFmpeg invocation. */
export function compilePlan(
  plan: MediaPlan,
  source: MediaMetadata,
  output: string,
): CompiledOperation {
  const specialStep = plan.steps.find(
    (step) =>
      step.operation === 'extract-audio' ||
      step.operation === 'extract-frame' ||
      step.operation === 'concatenate',
  );
  if (specialStep !== undefined) return compileSpecial(plan, specialStep, source, output);
  if (plan.steps.length === 0) {
    return {
      executable: 'ffmpeg',
      args: [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        plan.source.path,
        '-map',
        '0',
        '-c',
        'copy',
        output,
      ],
    };
  }

  const args = ['-hide_banner', '-nostdin', '-y'];
  const trim = plan.steps.find((step) => step.operation === 'trim');
  if (trim?.operation === 'trim') {
    args.push('-ss', String(trim.startSeconds));
    if (trim.endSeconds !== undefined) args.push('-to', String(trim.endSeconds));
  }
  args.push('-i', plan.source.path);
  const filters = plan.steps.flatMap((step) => filtersForStep(step, source));
  if (filters.length > 0) args.push('-vf', filters.join(','));

  const encode = plan.steps.find((step) => step.operation === 'encode');
  if (encode?.operation === 'encode') {
    args.push(...encodingArgs(encode, source, plan));
  } else {
    args.push('-c:v', 'libx264', '-c:a', 'aac');
  }
  if (plan.expectations.audio === 'remove') args.push('-an');
  args.push('-movflags', '+faststart', output);
  return { executable: 'ffmpeg', args };
}

function compileSpecial(
  plan: MediaPlan,
  step: MediaStep,
  source: MediaMetadata,
  output: string,
): CompiledOperation {
  if (step.operation === 'extract-audio') {
    return {
      executable: 'ffmpeg',
      args: [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        plan.source.path,
        '-vn',
        '-c:a',
        audioCodec(step.format),
        output,
      ],
    };
  }
  if (step.operation === 'extract-frame') {
    return {
      executable: 'ffmpeg',
      args: [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-ss',
        String(step.atSeconds),
        '-i',
        plan.source.path,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        output,
      ],
    };
  }
  if (step.operation === 'concatenate') {
    const args = ['-hide_banner', '-nostdin', '-y'];
    for (const input of step.inputs) args.push('-i', input);
    const hasVideo = source.video !== undefined;
    const hasAudio = source.audio.present;
    const labels = step.inputs
      .map((_, index) => `${hasVideo ? `[${index}:v]` : ''}${hasAudio ? `[${index}:a]` : ''}`)
      .join('');
    const outputs = `${hasVideo ? '[v]' : ''}${hasAudio ? '[a]' : ''}`;
    args.push(
      '-filter_complex',
      `${labels}concat=n=${step.inputs.length}:v=${hasVideo ? 1 : 0}:a=${hasAudio ? 1 : 0}${outputs}`,
    );
    if (hasVideo) args.push('-map', '[v]', '-c:v', 'libx264');
    if (hasAudio) {
      args.push('-map', '[a]', '-c:a', hasVideo ? 'aac' : audioCodecForOutput(output));
    }
    args.push(output);
    return { executable: 'ffmpeg', args };
  }
  throw new MediaError({
    code: 'INVALID_PLAN',
    message: `Unsupported special operation: ${step.operation}.`,
  });
}

function filtersForStep(step: MediaStep, source: MediaMetadata): string[] {
  if (step.operation === 'resize') return [`scale=${step.width}:${step.height}:flags=lanczos`];
  if (step.operation !== 'reframe') return [];
  if (source.video === undefined)
    throw new MediaError({
      code: 'UNSUPPORTED_INPUT',
      message: 'Reframing requires a video stream.',
    });
  const [ratioWidth, ratioHeight] = step.aspectRatio.split(':').map(Number);
  if (ratioWidth === undefined || ratioHeight === undefined)
    throw new MediaError({ code: 'INVALID_PLAN', message: 'Invalid aspect ratio in plan.' });
  const targetRatio = ratioWidth / ratioHeight;
  const sourceRatio = source.video.width / source.video.height;
  if (sourceRatio > targetRatio) {
    const width = even(source.video.height * targetRatio);
    return [`crop=${width}:${source.video.height}:(iw-${width})/2:0`];
  }
  const height = even(source.video.width / targetRatio);
  return [`crop=${source.video.width}:${height}:0:(ih-${height})/2`];
}

function encodingArgs(
  step: Extract<MediaStep, { operation: 'encode' }>,
  source: MediaMetadata,
  plan: MediaPlan,
): string[] {
  const args = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'];
  const crf =
    step.profile === 'high-quality' ? '18' : step.profile === 'high-compatibility' ? '23' : '21';
  args.push('-crf', crf, '-preset', 'medium');
  if (step.maxSizeMB !== undefined) {
    const duration = plan.expectations.durationSeconds ?? source.durationSeconds;
    if (duration !== undefined && duration > 0) {
      const totalKbps = Math.max(64, Math.floor((step.maxSizeMB * 8_000 * 0.94) / duration));
      const videoKbps = Math.max(32, totalKbps - 128);
      args.push(
        '-b:v',
        `${videoKbps}k`,
        '-maxrate',
        `${videoKbps}k`,
        '-bufsize',
        `${videoKbps * 2}k`,
      );
    }
  }
  return args;
}

function audioCodec(format: 'm4a' | 'mp3' | 'wav'): string {
  return format === 'mp3' ? 'libmp3lame' : format === 'wav' ? 'pcm_s16le' : 'aac';
}

function audioCodecForOutput(output: string): string {
  const extension = extname(output).slice(1).toLowerCase();
  return extension === 'mp3' || extension === 'wav' ? audioCodec(extension) : audioCodec('m4a');
}

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function extensionForPlan(plan: MediaPlan): string {
  const special = plan.steps.find(
    (step) => step.operation === 'extract-audio' || step.operation === 'extract-frame',
  );
  if (special?.operation === 'extract-audio') return `.${special.format}`;
  if (special?.operation === 'extract-frame') return `.${special.format}`;
  return extname(plan.source.path) || '.mp4';
}
