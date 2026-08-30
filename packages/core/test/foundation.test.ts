import { describe, expect, it } from 'vitest';

import { planMedia, validatePlan, verifyMedia } from '../src/index.js';
import type { MediaMetadata } from '../src/index.js';

const videoSource: MediaMetadata = {
  path: '/media/source.mp4',
  kind: 'video',
  durationSeconds: 6,
  container: 'mp4',
  sizeBytes: 100_000,
  video: { width: 320, height: 180, aspectRatio: '16:9', codec: 'h264', pixelFormat: 'yuv420p' },
  audio: { present: true, codec: 'aac', sampleRate: 48000, channels: 2 },
};

describe('workspace foundation', () => {
  it('exports the semantic planning API', () => {
    expect(planMedia).toBeTypeOf('function');
  });

  it('requires concatenation to begin with the declared source', () => {
    expect(() =>
      validatePlan({
        irVersion: '1',
        source: { path: '/media/first.mp4' },
        constraints: {},
        steps: [
          {
            id: 'join',
            operation: 'concatenate',
            inputs: ['/media/different.mp4', '/media/second.mp4'],
            reason: 'test',
          },
        ],
        expectations: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });

  it('rejects an empty goals object with INVALID_PLAN', () => {
    expect(() => planMedia({ source: videoSource, goals: {} })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
  });

  it('does not pass verification when no expectations were recorded', () => {
    const output: MediaMetadata = {
      path: '/media/out.mp4',
      kind: 'video',
      durationSeconds: 2,
      container: 'mp4',
      sizeBytes: 50_000,
      video: { width: 320, height: 180, aspectRatio: '16:9' },
      audio: { present: true },
    };
    const report = verifyMedia(output, {});
    expect(report.passed).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures[0]).toContain('unverifiable');
  });

  it('range-checks extractFrame atSeconds against source duration', () => {
    expect(() =>
      planMedia({
        source: videoSource,
        goals: { extractFrame: { atSeconds: 99 } },
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });

  it('rejects still images for visual transform goals', () => {
    const imageSource: MediaMetadata = {
      path: '/media/photo.png',
      kind: 'image',
      sizeBytes: 2048,
      video: { width: 800, height: 600, aspectRatio: '4:3' },
      audio: { present: false },
    };
    expect(() => planMedia({ source: imageSource, goals: { compatibility: 'high' } })).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
  });
});
