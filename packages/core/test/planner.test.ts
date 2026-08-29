import { describe, expect, it } from 'vitest';

import { MediaError, parsePlan, planMedia, serializePlan } from '../src/index.js';

const source = {
  path: '/media/demo.mov',
  kind: 'video' as const,
  durationSeconds: 60,
  container: 'mov',
  sizeBytes: 100,
  video: { width: 1920, height: 1080, aspectRatio: '16:9', fps: 30, codec: 'h264' },
  audio: { present: true, codec: 'aac' },
};

describe('semantic planner', () => {
  it('creates a versioned, explainable plan', () => {
    const plan = planMedia({
      source,
      goals: {
        trimStartSeconds: 2,
        durationSeconds: 30,
        aspectRatio: '9:16',
        maxSizeMB: 25,
        compatibility: 'high',
      },
      capabilities: {
        ffmpegVersion: 'test',
        encoders: { h264: true, hevc: false, av1: false, aac: true },
        hardwareAcceleration: [],
        filters: { scale: true, crop: true, concat: true, subtitles: false },
      },
    });

    expect(plan).toMatchObject({
      irVersion: '1',
      constraints: { maxSizeMB: 25, compatibility: 'high' },
      expectations: { durationSeconds: 30, aspectRatio: '9:16', maxSizeBytes: 25_000_000 },
    });
    expect(plan.steps.map((step) => step.operation)).toEqual(['trim', 'reframe', 'encode']);
    expect(plan.steps.every((step) => step.reason.length > 0)).toBe(true);
    expect(parsePlan(serializePlan(plan))).toEqual(plan);
  });

  it('rejects conflicting goals with a stable error', () => {
    expect(() => planMedia({ source, goals: { trimStartSeconds: 10, trimEndSeconds: 5 } })).toThrow(
      MediaError,
    );
    try {
      planMedia({ source, goals: { width: 1080 } });
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_PLAN' });
    }
  });
});
