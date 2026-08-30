import { MediaError } from './errors.js';
import { validatePlan } from './ir.js';
import type { MediaPlan, MediaStep } from './ir.js';
import type { MediaMetadata } from './media.js';

/** A mechanical plan issue detected before execution. */
export interface PlanIssue {
  field: string;
  message: string;
  repairable: boolean;
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

const EPSILON = 0.001;

/**
 * Detect mechanical plan issues against real source metadata: impossible trims,
 * frame timestamps beyond duration, and dimension conflicts between steps.
 * Schema-level validation still applies; this reports what a repair could fix.
 */
export function inspectPlanIssues(plan: MediaPlan, source: MediaMetadata): PlanIssue[] {
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

function matchesAspectRatio(width: number, height: number, aspectRatio: string): boolean {
  const [ratioWidth, ratioHeight] = aspectRatio.split(':').map(Number);
  return width * ratioHeight! === height * ratioWidth!;
}

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}
