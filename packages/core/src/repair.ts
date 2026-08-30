import { MediaError } from './errors.js';
import { validatePlan } from './ir.js';
import type { MediaPlan, MediaStep } from './ir.js';
import type { MediaMetadata } from './media.js';

/** A mechanical plan issue detected before execution. */
export interface PlanIssue {
  field: string;
  message: string;
  repairable: boolean;
  /**
   * For issues a plan repair cannot fix on its own — concatenation inputs that disagree on stream
   * layout — the normalization work that would make the plan executable.
   */
  normalization?: ConcatenationNormalization[];
}

/** A normalization pass that would make one concatenation input match the baseline clip. */
export interface ConcatenationNormalization {
  input: string;
  differences: string[];
  plan: MediaPlan;
}

/** A single repair applied to a plan, reported structurally. */
export interface PlanRepair {
  field: string;
  action: string;
  from: unknown;
  to: unknown;
}

export interface RepairedPlan {
  plan: MediaPlan;
  repairs: PlanRepair[];
}

export interface InspectPlanOptions {
  /**
   * Inspected metadata for every clip named by a concatenation step, in order. Without it,
   * stream-layout conflicts stay invisible until FFmpeg refuses the join.
   */
  concatenationSources?: MediaMetadata[];
}

const EPSILON = 0.001;

/**
 * Detect mechanical plan issues against real source metadata: impossible trims,
 * frame timestamps beyond duration, and dimension conflicts between steps.
 * Schema-level validation still applies; this reports what a repair could fix.
 */
export function inspectPlanIssues(
  plan: MediaPlan,
  source: MediaMetadata,
  options: InspectPlanOptions = {},
): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const duration = source.durationSeconds;

  for (const step of plan.steps) {
    if (step.operation === 'trim') {
      if (duration !== undefined) {
        if (step.startSeconds >= duration) {
          issues.push({
            field: `steps.${step.id}.startSeconds`,
            message: `Trim start ${step.startSeconds}s is at or beyond the source duration ${duration}s.`,
            repairable: true,
          });
        }
        if (step.endSeconds !== undefined && step.endSeconds > duration + EPSILON) {
          issues.push({
            field: `steps.${step.id}.endSeconds`,
            message: `Trim end ${step.endSeconds}s extends beyond the source duration ${duration}s.`,
            repairable: true,
          });
        }
      }
      if (step.endSeconds !== undefined && step.endSeconds <= step.startSeconds) {
        issues.push({
          field: `steps.${step.id}.endSeconds`,
          message: `Trim end ${step.endSeconds}s is not after trim start ${step.startSeconds}s.`,
          repairable: false,
        });
      }
    }
    if (step.operation === 'extract-frame' && duration !== undefined) {
      if (step.atSeconds >= duration) {
        issues.push({
          field: `steps.${step.id}.atSeconds`,
          message: `Frame timestamp ${step.atSeconds}s is at or beyond the source duration ${duration}s.`,
          repairable: true,
        });
      }
    }
  }

  const reframe = plan.steps.find((step) => step.operation === 'reframe');
  const resize = plan.steps.find((step) => step.operation === 'resize');
  if (reframe?.operation === 'reframe' && resize?.operation === 'resize') {
    if (!matchesAspectRatio(resize.width, resize.height, reframe.aspectRatio)) {
      issues.push({
        field: 'steps.resize.dimensions',
        message: `Resize dimensions ${resize.width}x${resize.height} do not match the reframed aspect ratio ${reframe.aspectRatio}.`,
        repairable: true,
      });
    }
  }

  if (source.video !== undefined && resize?.operation === 'resize') {
    const upscale = resize.width > source.video.width || resize.height > source.video.height;
    if (upscale) {
      issues.push({
        field: 'steps.resize.dimensions',
        message: `Resize ${resize.width}x${resize.height} upscales beyond the source ${source.video.width}x${source.video.height}.`,
        repairable: false,
      });
    }
  }

  const concatenate = plan.steps.find((step) => step.operation === 'concatenate');
  const clips = options.concatenationSources;
  if (concatenate?.operation === 'concatenate' && clips !== undefined && clips.length > 1) {
    const normalization = planConcatenationNormalization(clips);
    if (normalization.length > 0) {
      issues.push({
        field: `steps.${concatenate.id}.inputs`,
        message: `Concatenation inputs disagree on stream layout: ${normalization
          .map((entry) => `${entry.input} (${entry.differences.join(', ')})`)
          .join('; ')}.`,
        // Repairing this means re-encoding other files, which is execution, not plan repair.
        repairable: false,
        normalization,
      });
    }
  }

  return issues;
}

/**
 * Repair mechanical plan issues against real source metadata: clamp trims and
 * frame timestamps into the source duration, and reconcile resize dimensions
 * with the reframed aspect ratio. Every repair is reported; nothing is silent.
 * Unrepairable issues throw INVALID_PLAN.
 */
export function repairPlan(plan: MediaPlan, source: MediaMetadata): RepairedPlan {
  const repairs: PlanRepair[] = [];
  const duration = source.durationSeconds;

  const repairedSteps: MediaStep[] = plan.steps.map((step) => {
    if (step.operation === 'trim') {
      let { startSeconds, endSeconds } = step;
      if (duration !== undefined && startSeconds >= duration) {
        const clamped = Math.max(0, duration - EPSILON);
        repairs.push({
          field: `steps.${step.id}.startSeconds`,
          action: 'clamped into source duration',
          from: startSeconds,
          to: clamped,
        });
        startSeconds = clamped;
      }
      if (duration !== undefined && endSeconds !== undefined && endSeconds > duration + EPSILON) {
        repairs.push({
          field: `steps.${step.id}.endSeconds`,
          action: 'clamped into source duration',
          from: endSeconds,
          to: duration,
        });
        endSeconds = duration;
      }
      if (endSeconds !== undefined && endSeconds <= startSeconds) {
        throw new MediaError({
          code: 'INVALID_PLAN',
          message: `Trim step ${step.id} has an empty time range that cannot be repaired automatically.`,
          context: { stepId: step.id, startSeconds, endSeconds },
          suggestedActions: ['Remove the trim step or provide a valid time range.'],
        });
      }
      return startSeconds === step.startSeconds && endSeconds === step.endSeconds
        ? step
        : { ...step, startSeconds, ...(endSeconds === undefined ? {} : { endSeconds }) };
    }
    if (
      step.operation === 'extract-frame' &&
      duration !== undefined &&
      step.atSeconds >= duration
    ) {
      const clamped = Math.max(0, duration - EPSILON);
      repairs.push({
        field: `steps.${step.id}.atSeconds`,
        action: 'clamped into source duration',
        from: step.atSeconds,
        to: clamped,
      });
      return { ...step, atSeconds: clamped };
    }
    return step;
  });

  const reframe = repairedSteps.find((step) => step.operation === 'reframe');
  const resizeIndex = repairedSteps.findIndex((step) => step.operation === 'resize');
  if (reframe?.operation === 'reframe' && resizeIndex !== -1) {
    const resize = repairedSteps[resizeIndex];
    if (
      resize?.operation === 'resize' &&
      !matchesAspectRatio(resize.width, resize.height, reframe.aspectRatio)
    ) {
      const [ratioWidth, ratioHeight] = reframe.aspectRatio.split(':').map(Number);
      const height = even(resize.width * (ratioHeight! / ratioWidth!));
      repairs.push({
        field: 'steps.resize.height',
        action: `reconciled with aspect ratio ${reframe.aspectRatio}`,
        from: resize.height,
        to: height,
      });
      repairedSteps[resizeIndex] = { ...resize, height };
    }
  }

  if (source.video !== undefined) {
    const resize = repairedSteps.find((step) => step.operation === 'resize');
    if (
      resize?.operation === 'resize' &&
      (resize.width > source.video.width || resize.height > source.video.height)
    ) {
      throw new MediaError({
        code: 'INVALID_PLAN',
        message: `Resize ${resize.width}x${resize.height} upscales beyond the source ${source.video.width}x${source.video.height} and cannot be repaired automatically.`,
        context: {
          requested: `${resize.width}x${resize.height}`,
          source: `${source.video.width}x${source.video.height}`,
        },
        suggestedActions: ['Request dimensions at or below the source resolution.'],
      });
    }
  }

  return {
    plan: validatePlan({ ...plan, steps: repairedSteps }),
    repairs,
  };
}

/**
 * Compare every concatenation clip against the first and, for each that disagrees, produce the
 * Media IR plan that would normalize it to the baseline layout. Concatenation itself cannot fix a
 * layout conflict; running these plans first can.
 */
export function planConcatenationNormalization(
  clips: MediaMetadata[],
): ConcatenationNormalization[] {
  const baseline = clips[0];
  if (baseline === undefined) return [];
  const normalizations: ConcatenationNormalization[] = [];
  for (const candidate of clips.slice(1)) {
    const differences = streamDifferences(baseline, candidate);
    if (differences.length === 0) continue;
    normalizations.push({
      input: candidate.path,
      differences,
      plan: normalizationPlan(baseline, candidate),
    });
  }
  return normalizations;
}

/** Stream-layout fields that must agree before two sources can be concatenated. */
export function streamDifferences(baseline: MediaMetadata, candidate: MediaMetadata): string[] {
  const differences: string[] = [];
  const compare = (field: string, left: unknown, right: unknown): void => {
    if (left !== right) differences.push(field);
  };
  compare('video.present', baseline.video !== undefined, candidate.video !== undefined);
  compare('audio.present', baseline.audio.present, candidate.audio.present);
  if (baseline.video !== undefined && candidate.video !== undefined) {
    compare('video.width', baseline.video.width, candidate.video.width);
    compare('video.height', baseline.video.height, candidate.video.height);
    compare('video.fps', baseline.video.fps, candidate.video.fps);
    compare('video.pixelFormat', baseline.video.pixelFormat, candidate.video.pixelFormat);
  }
  if (baseline.audio.present && candidate.audio.present) {
    compare('audio.sampleRate', baseline.audio.sampleRate, candidate.audio.sampleRate);
    compare('audio.channels', baseline.audio.channels, candidate.audio.channels);
  }
  return differences;
}

function normalizationPlan(baseline: MediaMetadata, candidate: MediaMetadata): MediaPlan {
  const steps: MediaStep[] = [];
  if (
    baseline.video !== undefined &&
    candidate.video !== undefined &&
    (baseline.video.width !== candidate.video.width ||
      baseline.video.height !== candidate.video.height)
  ) {
    steps.push({
      id: 'resize-1',
      operation: 'resize',
      width: baseline.video.width,
      height: baseline.video.height,
      reason: 'Match the baseline clip dimensions so the clips can be concatenated.',
    });
  }
  steps.push({
    id: `encode-${steps.length + 1}`,
    operation: 'encode',
    profile: 'high-compatibility',
    reason: 'Re-encode to a common stream layout so the clips can be concatenated.',
  });
  return validatePlan({
    irVersion: '1',
    source: { path: candidate.path },
    constraints: { compatibility: 'high' },
    steps,
    expectations: {
      ...(baseline.video === undefined
        ? {}
        : { width: baseline.video.width, height: baseline.video.height }),
      audio: baseline.audio.present ? 'required' : 'remove',
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
    },
  });
}

function matchesAspectRatio(width: number, height: number, aspectRatio: string): boolean {
  const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
  return width * ratioHeight! === height * ratioWidth!;
}

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}
