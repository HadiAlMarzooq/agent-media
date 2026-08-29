import { MediaError } from './errors.js';
import type { FfmpegCapabilities, MediaMetadata } from './media.js';
import type { MediaPlan, MediaStep } from './ir.js';

export interface MediaGoals {
  trimStartSeconds?: number;
  trimEndSeconds?: number;
  durationSeconds?: number;
  aspectRatio?: string;
  width?: number;
  height?: number;
  maxSizeMB?: number;
  compatibility?: 'high' | 'balanced';
  quality?: 'high' | 'balanced' | 'small';
  audio?: 'preserve' | 'remove';
  extractAudio?: { format?: 'm4a' | 'mp3' | 'wav' };
  extractFrame?: { atSeconds?: number; format?: 'jpg' | 'png' };
  concatenate?: string[];
}

export interface PlanRequest {
  source: MediaMetadata;
  goals: MediaGoals;
  capabilities?: FfmpegCapabilities;
}

/** Turns a source description and semantic goals into versioned portable intent. */
export function planMedia(request: PlanRequest): MediaPlan {
  validateGoals(request);
  const { source, goals } = request;
  const steps: MediaStep[] = [];
  const expectations: MediaPlan['expectations'] = {};

  const trimEnd =
    goals.trimEndSeconds ??
    (goals.durationSeconds === undefined
      ? undefined
      : (source.durationSeconds ?? 0) > 0
        ? (goals.trimStartSeconds ?? 0) + goals.durationSeconds
        : undefined);
  if (goals.trimStartSeconds !== undefined || trimEnd !== undefined) {
    steps.push({
      id: `trim-${steps.length + 1}`,
      operation: 'trim',
      startSeconds: goals.trimStartSeconds ?? 0,
      ...(trimEnd === undefined ? {} : { endSeconds: trimEnd }),
      reason: 'The caller requested a shorter time range.',
    });
    const expectedDuration =
      trimEnd === undefined ? undefined : trimEnd - (goals.trimStartSeconds ?? 0);
    if (expectedDuration !== undefined) expectations.durationSeconds = expectedDuration;
  }
  if (goals.aspectRatio !== undefined && source.video?.aspectRatio !== goals.aspectRatio) {
    steps.push({
      id: `reframe-${steps.length + 1}`,
      operation: 'reframe',
      aspectRatio: goals.aspectRatio,
      strategy: 'center',
      reason: 'The requested output aspect ratio differs from the source.',
    });
    expectations.aspectRatio = goals.aspectRatio;
  }
  if (goals.width !== undefined && goals.height !== undefined) {
    if (source.video?.width !== goals.width || source.video.height !== goals.height) {
      steps.push({
        id: `resize-${steps.length + 1}`,
        operation: 'resize',
        width: goals.width,
        height: goals.height,
        reason: 'The caller requested explicit output dimensions.',
      });
    }
    expectations.width = goals.width;
    expectations.height = goals.height;
  }
  if (goals.extractAudio !== undefined) {
    steps.push({
      id: `extract-audio-${steps.length + 1}`,
      operation: 'extract-audio',
      format: goals.extractAudio.format ?? 'm4a',
      reason: 'The caller requested an audio-only output.',
    });
    expectations.container = goals.extractAudio.format ?? 'm4a';
    expectations.audio = 'required';
  } else if (goals.extractFrame !== undefined) {
    steps.push({
      id: `extract-frame-${steps.length + 1}`,
      operation: 'extract-frame',
      atSeconds: goals.extractFrame.atSeconds ?? 0,
      format: goals.extractFrame.format ?? 'jpg',
      reason: 'The caller requested a still frame from the source.',
    });
  } else if (goals.concatenate !== undefined) {
    steps.push({
      id: `concatenate-${steps.length + 1}`,
      operation: 'concatenate',
      inputs: [source.path, ...goals.concatenate],
      reason: 'The caller requested multiple media sources joined in sequence.',
    });
  } else if (requiresEncoding(goals)) {
    assertCodecCapability(request.capabilities, goals);
    steps.push({
      id: `encode-${steps.length + 1}`,
      operation: 'encode',
      profile: encodingProfile(goals),
      ...(goals.maxSizeMB === undefined ? {} : { maxSizeMB: goals.maxSizeMB }),
      reason: encodingReason(goals),
    });
  }
  if (goals.maxSizeMB !== undefined) expectations.maxSizeBytes = goals.maxSizeMB * 1_000_000;
  if (goals.audio === 'remove') expectations.audio = 'remove';
  else if (goals.audio === 'preserve') expectations.audio = 'preserve';

  return {
    irVersion: '1',
    source: { path: source.path },
    constraints: pickConstraints(goals),
    steps,
    expectations,
  };
}

function validateGoals({ source, goals }: PlanRequest): void {
  if (source.kind === 'unknown')
    fail('The source has no usable audio or video stream.', { source: source.path });
  if (goals.trimStartSeconds !== undefined && goals.trimStartSeconds < 0)
    fail('Trim start must be non-negative.');
  if (
    goals.trimEndSeconds !== undefined &&
    goals.trimStartSeconds !== undefined &&
    goals.trimEndSeconds <= goals.trimStartSeconds
  )
    fail('Trim end must be greater than trim start.');
  if ((goals.width === undefined) !== (goals.height === undefined))
    fail('Width and height must be provided together.');
  if (
    goals.width !== undefined &&
    (goals.width <= 0 || goals.height === undefined || goals.height <= 0)
  )
    fail('Output dimensions must be positive.');
  if (goals.extractAudio !== undefined && goals.extractFrame !== undefined)
    fail('Audio extraction and frame extraction cannot produce the same output.');
  if (goals.concatenate !== undefined && goals.concatenate.length === 0)
    fail('Concatenation requires at least one additional input.');
}

function fail(message: string, context?: Record<string, unknown>): never {
  throw new MediaError({
    code: 'INVALID_PLAN',
    message,
    ...(context === undefined ? {} : { context }),
    suggestedActions: ['Adjust the semantic goals and create a new plan.'],
  });
}

function requiresEncoding(goals: MediaGoals): boolean {
  return (
    goals.maxSizeMB !== undefined ||
    goals.compatibility !== undefined ||
    goals.quality !== undefined ||
    goals.audio === 'remove'
  );
}

function encodingProfile(goals: MediaGoals): 'high-compatibility' | 'balanced' | 'high-quality' {
  if (goals.compatibility === 'high') return 'high-compatibility';
  if (goals.quality === 'high') return 'high-quality';
  return 'balanced';
}

function encodingReason(goals: MediaGoals): string {
  if (goals.maxSizeMB !== undefined) return 'The caller requested a maximum output file size.';
  if (goals.compatibility === 'high') return 'A broadly compatible output was requested.';
  if (goals.audio === 'remove') return 'The caller requested removal of the audio stream.';
  return 'The caller requested a different quality profile.';
}

function assertCodecCapability(
  capabilities: FfmpegCapabilities | undefined,
  goals: MediaGoals,
): void {
  if (capabilities !== undefined && goals.compatibility === 'high' && !capabilities.encoders.h264) {
    fail('High compatibility requires an available H.264 encoder.', { capability: 'h264' });
  }
}

function pickConstraints(goals: MediaGoals): MediaPlan['constraints'] {
  return {
    ...(goals.maxSizeMB === undefined ? {} : { maxSizeMB: goals.maxSizeMB }),
    ...(goals.compatibility === undefined ? {} : { compatibility: goals.compatibility }),
    ...(goals.quality === undefined ? {} : { quality: goals.quality }),
  };
}
