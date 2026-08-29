import { describe, expect, it } from 'vitest';

import { MediaError, parsePlan, planMedia, serializePlan, validatePlan } from '../src/index.js';

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
    expect(plan.expectations).toMatchObject({ videoCodec: 'h264', pixelFormat: 'yuv420p' });
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

  it('maps malformed serialized and runtime plans to structured errors', () => {
    expect(() => parsePlan('{not json')).toThrow(MediaError);
    expect(() => parsePlan('{not json')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
    expect(() =>
      validatePlan({
        irVersion: '1',
        source: { path: '/media/demo.mov' },
        constraints: {},
        steps: [
          { id: 'duplicate', operation: 'trim', startSeconds: 0, reason: 'first' },
          { id: 'duplicate', operation: 'encode', profile: 'balanced', reason: 'second' },
        ],
        expectations: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
    expect(() =>
      validatePlan({
        irVersion: '1',
        source: { path: '/media/demo.mov' },
        constraints: {},
        steps: [
          { id: 'resize-1', operation: 'resize', width: 100, height: 100, reason: 'first' },
          { id: 'resize-2', operation: 'resize', width: 50, height: 50, reason: 'second' },
        ],
        expectations: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });

  it('rejects goals that Media IR v1 cannot compose without dropping work', () => {
    expect(() =>
      planMedia({ source, goals: { trimStartSeconds: 1, extractAudio: { format: 'm4a' } } }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
    expect(() => planMedia({ source, goals: { aspectRatio: '9:0' } })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
    expect(() => planMedia({ source, goals: { maxSizeMB: Number.NaN } })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
  });

  it('rejects unavailable compatibility encoders before execution', () => {
    expect(() =>
      planMedia({
        source,
        goals: { compatibility: 'high' },
        capabilities: {
          ffmpegVersion: 'test',
          encoders: { h264: false, hevc: false, av1: false, aac: true },
          hardwareAcceleration: [],
          filters: { scale: true, crop: true, concat: true, subtitles: false },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });

  it('rejects contradictory and impossible output constraints', () => {
    const unknownDurationSource = { ...source };
    delete (unknownDurationSource as Partial<typeof source>).durationSeconds;
    expect(() =>
      planMedia({
        source,
        goals: { durationSeconds: 10, trimEndSeconds: 20 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
    expect(() =>
      planMedia({
        source,
        goals: { trimStartSeconds: 55, durationSeconds: 10 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
    expect(() =>
      planMedia({
        source,
        goals: { aspectRatio: '9:16', width: 100, height: 100 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
    expect(() =>
      planMedia({
        source: unknownDurationSource,
        goals: { maxSizeMB: 10 },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });
});
