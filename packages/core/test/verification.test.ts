import { describe, expect, it } from 'vitest';

import { verifyMedia } from '../src/index.js';

const output = {
  path: '/media/out.mp4',
  kind: 'video' as const,
  durationSeconds: 30.1,
  container: 'mov',
  sizeBytes: 24_900_000,
  video: {
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    codec: 'h264',
    pixelFormat: 'yuv420p',
  },
  audio: { present: true },
};

describe('verification', () => {
  it('reports all requested constraints as structured passing checks', () => {
    const report = verifyMedia(output, {
      durationSeconds: 30,
      aspectRatio: '9:16',
      width: 1080,
      height: 1920,
      maxSizeBytes: 25_000_000,
      audio: 'preserve',
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
    });
    expect(report.passed).toBe(true);
    expect(Object.values(report.checks).every((check) => check.passed)).toBe(true);
  });

  it('explains failed constraints without throwing', () => {
    const report = verifyMedia(output, {
      aspectRatio: '1:1',
      maxSizeBytes: 1_000,
      audio: 'remove',
      videoCodec: 'hevc',
      pixelFormat: 'yuv444p',
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toHaveLength(5);
    expect(report.checks.maxFileSize).toMatchObject({ passed: false, actual: 24_900_000 });
  });
});
