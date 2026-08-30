import { MediaError } from './errors.js';
import { aspectRatioSchema, validatePlan } from './ir.js';
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
    expectations.audio = 'required';
  } else if (goals.extractFrame !== undefined) {
    steps.push({
      id: `extract-frame-${steps.length + 1}`,
      operation: 'extract-frame',
      atSeconds: goals.extractFrame.atSeconds ?? 0,
      format: goals.extractFrame.format ?? 'jpg',
      reason: 'The caller requested a still frame from the source.',
    });
    if (source.video !== undefined) {
      expectations.width = source.video.width;
      expectations.height = source.video.height;
    }
  } else if (goals.concatenate !== undefined) {
    steps.push({
      id: `concatenate-${steps.length + 1}`,
      operation: 'concatenate',
      inputs: [source.path, ...goals.concatenate],
      reason: 'The caller requested multiple media sources joined in sequence.',
    });
    if (source.durationSeconds !== undefined) {
      expectations.durationSeconds = source.durationSeconds * (goals.concatenate.length + 1);
    }
    expectations.audio = source.audio.present ? 'preserve' : 'remove';
  } else if (requiresEncoding(goals)) {
    assertCodecCapability(request.capabilities, goals, source);
    steps.push({
      id: `encode-${steps.length + 1}`,
      operation: 'encode',
      profile: encodingProfile(goals),
      ...(goals.maxSizeMB === undefined ? {} : { maxSizeMB: goals.maxSizeMB }),
      reason: encodingReason(goals),
    });
  }
  if (goals.maxSizeMB !== undefined) expectations.maxSizeBytes = goals.maxSizeMB * 1_000_000;
  if (goals.compatibility === 'high') {
    expectations.videoCodec = 'h264';
    expectations.pixelFormat = 'yuv420p';
  }
  if (goals.audio === 'remove') expectations.audio = 'remove';
  else if (goals.audio === 'preserve') expectations.audio = 'preserve';

  return validatePlan({
    irVersion: '1',
    source: { path: source.path },
    constraints: pickConstraints(goals),
    steps,
    expectations,
  });
}

function validateGoals({ source, goals }: PlanRequest): void {
  if (source.kind === 'unknown')
    fail('The source has no usable audio or video stream.', { source: source.path });
  const hasAnyGoal = Object.values(goals).some((v) => v !== undefined);
  if (!hasAnyGoal)
    fail('At least one goal must be provided. An empty goals object produces a no-op plan.');
  if (goals.trimStartSeconds !== undefined && goals.trimStartSeconds < 0)
    fail('Trim start must be non-negative.');
  if (goals.trimStartSeconds !== undefined && !Number.isFinite(goals.trimStartSeconds))
    fail('Trim start must be a finite number.');
  if (goals.trimEndSeconds !== undefined && !Number.isFinite(goals.trimEndSeconds))
    fail('Trim end must be a finite number.');
  if (goals.durationSeconds !== undefined && !(goals.durationSeconds > 0))
    fail('Duration must be positive.');
  if (goals.durationSeconds !== undefined && goals.trimEndSeconds !== undefined)
    fail('Duration and trim end cannot both define the output range.');
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
    (!Number.isInteger(goals.width) ||
      goals.width <= 0 ||
      goals.height === undefined ||
      !Number.isInteger(goals.height) ||
      goals.height <= 0)
  )
    fail('Output dimensions must be positive integers.');
  if (goals.maxSizeMB !== undefined && !(goals.maxSizeMB > 0))
    fail('Maximum file size must be positive.');
  if (
    goals.durationSeconds !== undefined &&
    source.durationSeconds === undefined &&
    goals.trimEndSeconds === undefined
  )
    fail('A duration goal requires a source with a known duration.');
  const requestedEnd =
    goals.trimEndSeconds ??
    (goals.durationSeconds === undefined
      ? undefined
      : (goals.trimStartSeconds ?? 0) + goals.durationSeconds);
  if (
    source.durationSeconds !== undefined &&
    requestedEnd !== undefined &&
    requestedEnd > source.durationSeconds
  )
    fail('The requested time range extends beyond the source duration.', {
      requestedEnd,
      sourceDuration: source.durationSeconds,
    });
  if (
    source.durationSeconds !== undefined &&
    goals.trimStartSeconds !== undefined &&
    goals.trimStartSeconds >= source.durationSeconds
  )
    fail('Trim start must be before the end of the source.');
  if (goals.maxSizeMB !== undefined && source.durationSeconds === undefined)
    fail('Maximum-size planning requires a source with a known duration.');
  if (goals.aspectRatio !== undefined && !aspectRatioSchema.safeParse(goals.aspectRatio).success)
    fail('Aspect ratio must contain positive width and height values, such as 9:16.');
  if (
    goals.aspectRatio !== undefined &&
    goals.width !== undefined &&
    goals.height !== undefined &&
    !dimensionsMatchAspectRatio(goals.width, goals.height, goals.aspectRatio)
  )
    fail('Explicit dimensions must match the requested aspect ratio.');
  if (
    source.video === undefined &&
    (goals.aspectRatio !== undefined ||
      goals.width !== undefined ||
      goals.extractFrame !== undefined)
  )
    fail('The requested visual operation requires a video stream.', { source: source.path });
  if (
    source.kind === 'image' &&
    (goals.aspectRatio !== undefined ||
      goals.width !== undefined ||
      goals.height !== undefined ||
      goals.compatibility !== undefined ||
      goals.quality !== undefined ||
      goals.maxSizeMB !== undefined)
  )
    fail('Still images cannot be transformed by Media IR v1. Provide a video source.', {
      source: source.path,
      kind: source.kind,
    });
  if (goals.extractAudio !== undefined && !source.audio.present)
    fail('Audio extraction requires an audio stream.', { source: source.path });
  if (goals.audio === 'preserve' && !source.audio.present)
    fail('Audio cannot be preserved because the source has no audio stream.', {
      source: source.path,
    });
  if (goals.extractAudio !== undefined && goals.extractFrame !== undefined)
    fail('Audio extraction and frame extraction cannot produce the same output.');
  if (
    goals.extractFrame !== undefined &&
    goals.extractFrame.atSeconds !== undefined &&
    source.durationSeconds !== undefined &&
    goals.extractFrame.atSeconds >= source.durationSeconds
  )
    fail('Frame extraction timestamp must be before the end of the source.', {
      requestedAt: goals.extractFrame.atSeconds,
      sourceDuration: source.durationSeconds,
    });
  if (goals.concatenate !== undefined && goals.concatenate.length === 0)
    fail('Concatenation requires at least one additional input.');
  const terminalGoal =
    goals.extractAudio !== undefined ||
    goals.extractFrame !== undefined ||
    goals.concatenate !== undefined;
  if (terminalGoal && hasTransformGoal(goals)) {
    fail(
      'Extraction and concatenation cannot be combined with transformation goals in Media IR v1.',
    );
  }
}

function dimensionsMatchAspectRatio(width: number, height: number, aspectRatio: string): boolean {
  const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
  return (
    ratioWidth !== undefined &&
    ratioHeight !== undefined &&
    width * ratioHeight === height * ratioWidth
  );
}

function hasTransformGoal(goals: MediaGoals): boolean {
  return (
    goals.trimStartSeconds !== undefined ||
    goals.trimEndSeconds !== undefined ||
    goals.durationSeconds !== undefined ||
    goals.aspectRatio !== undefined ||
    goals.width !== undefined ||
    goals.height !== undefined ||
    goals.maxSizeMB !== undefined ||
    goals.compatibility !== undefined ||
    goals.quality !== undefined ||
    goals.audio !== undefined
  );
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
  source: MediaMetadata,
): void {
  if (capabilities !== undefined && goals.compatibility === 'high' && !capabilities.encoders.h264) {
    fail('High compatibility requires an available H.264 encoder.', { capability: 'h264' });
  }
  if (
    capabilities !== undefined &&
    goals.compatibility === 'high' &&
    source.audio.present &&
    goals.audio !== 'remove' &&
    !capabilities.encoders.aac
  ) {
    fail('High compatibility with audio requires an available AAC encoder.', {
      capability: 'aac',
    });
  }
}

function pickConstraints(goals: MediaGoals): MediaPlan['constraints'] {
  return {
    ...(goals.maxSizeMB === undefined ? {} : { maxSizeMB: goals.maxSizeMB }),
    ...(goals.compatibility === undefined ? {} : { compatibility: goals.compatibility }),
    ...(goals.quality === undefined ? {} : { quality: goals.quality }),
  };
}
