import { describe, expect, it } from 'vitest';

import {
  MEDIA_IR_VERSION,
  buildReceipt,
  planConcatenationNormalization,
  validateReceipt,
  inspectPlanIssues,
  parseReceipt,
  planFingerprint,
  planMedia,
  receiptMatches,
  repairPlan,
  validatePlan,
  verifyMedia,
  mediaPlanJsonSchema,
} from '../src/index.js';
import type { MediaMetadata, MediaPlan } from '../src/index.js';

const source: MediaMetadata = {
  path: '/media/source.mp4',
  kind: 'video',
  durationSeconds: 6,
  container: 'mp4',
  sizeBytes: 100_000,
  video: { width: 320, height: 180, aspectRatio: '16:9', codec: 'h264', pixelFormat: 'yuv420p' },
  audio: { present: true, codec: 'aac', sampleRate: 48000, channels: 2 },
};

function planWithSteps(steps: MediaPlan['steps']): MediaPlan {
  return validatePlan({
    irVersion: '1',
    source: { path: source.path },
    constraints: {},
    steps,
    expectations: {},
  });
}

describe('plan repair', () => {
  it('detects trims beyond the source duration', () => {
    const plan = planWithSteps([
      { id: 'trim', operation: 'trim', startSeconds: 0, endSeconds: 10, reason: 'test' },
    ]);
    const issues = inspectPlanIssues(plan, source);
    expect(issues.some((issue) => issue.field.includes('endSeconds') && issue.repairable)).toBe(
      true,
    );
  });

  it('clamps an out-of-range trim end and reports the repair', () => {
    const plan = planWithSteps([
      { id: 'trim', operation: 'trim', startSeconds: 0, endSeconds: 10, reason: 'test' },
    ]);
    const { plan: repaired, repairs } = repairPlan(plan, source);
    expect(repaired.steps[0]).toMatchObject({ operation: 'trim', endSeconds: 6 });
    expect(repairs).toEqual([
      expect.objectContaining({
        field: 'steps.trim.endSeconds',
        action: 'clamped into source duration',
        from: 10,
        to: 6,
      }),
    ]);
  });

  it('clamps an out-of-range frame timestamp and reports the repair', () => {
    const plan = planWithSteps([
      { id: 'frame', operation: 'extract-frame', atSeconds: 99, format: 'jpg', reason: 'test' },
    ]);
    const { plan: repaired, repairs } = repairPlan(plan, source);
    expect(repaired.steps[0]).toMatchObject({
      operation: 'extract-frame',
      atSeconds: expect.any(Number),
    });
    expect((repaired.steps[0] as { atSeconds: number }).atSeconds).toBeLessThan(6);
    expect(repairs.length).toBe(1);
  });

  it('reconciles resize height with the reframed aspect ratio', () => {
    // 180x320 already is 9:16, so the aspect ratio itself is not an issue here.
    const consistent = planWithSteps([
      {
        id: 'reframe',
        operation: 'reframe',
        aspectRatio: '9:16',
        strategy: 'center',
        reason: 'test',
      },
      { id: 'resize', operation: 'resize', width: 180, height: 320, reason: 'test' },
    ]);
    expect(
      inspectPlanIssues(consistent, source).some(
        (issue) =>
          issue.field.includes('resize.dimensions') && issue.message.includes('aspect ratio'),
      ),
    ).toBe(false);

    const conflicting = planWithSteps([
      {
        id: 'reframe',
        operation: 'reframe',
        aspectRatio: '9:16',
        strategy: 'center',
        reason: 'test',
      },
      { id: 'resize', operation: 'resize', width: 180, height: 180, reason: 'test' },
    ]);
    expect(
      inspectPlanIssues(conflicting, source).some(
        (issue) => issue.message.includes('9:16') && issue.repairable,
      ),
    ).toBe(true);

    const mismatched = planWithSteps([
      {
        id: 'reframe',
        operation: 'reframe',
        aspectRatio: '1:1',
        strategy: 'center',
        reason: 'test',
      },
      { id: 'resize', operation: 'resize', width: 180, height: 320, reason: 'test' },
    ]);
    const { plan: repaired, repairs } = repairPlan(mismatched, source);
    expect(repaired.steps[1]).toMatchObject({ operation: 'resize', width: 180, height: 180 });
    expect(repairs).toEqual([
      expect.objectContaining({ field: 'steps.resize.height', from: 320, to: 180 }),
    ]);
  });

  it('throws on an empty trim range that cannot be repaired', () => {
    const plan = planWithSteps([
      { id: 'trim', operation: 'trim', startSeconds: 4, endSeconds: 2, reason: 'test' },
    ]);
    expect(() => repairPlan(plan, source)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
  });

  it('throws on an upscaled resize that cannot be repaired', () => {
    const plan = planWithSteps([
      { id: 'resize', operation: 'resize', width: 1920, height: 1080, reason: 'test' },
    ]);
    expect(() => repairPlan(plan, source)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
  });
});

describe('execution receipts', () => {
  const plan = planMedia({ source, goals: { compatibility: 'high' } });

  it('builds, serializes, and replays a receipt', () => {
    const receipt = buildReceipt({
      plan,
      source: { path: source.path, sizeBytes: source.sizeBytes, durationSeconds: 6 },
      backend: { name: 'ffmpeg' },
      output: { path: '/media/out.mp4', sizeBytes: 50_000, durationSeconds: 6 },
      executedSteps: plan.steps.map((step) => step.id),
      verification: verifyMedia(
        { ...source, path: '/media/out.mp4', sizeBytes: 50_000 },
        plan.expectations,
      ),
    });
    const parsed = parseReceipt(JSON.stringify(receipt));
    expect(parsed.receiptVersion).toBe('1');
    expect(parsed.planFingerprint).toBe(planFingerprint(plan));
    expect(parsed.verification.passed).toBe(true);
  });

  it('rejects malformed receipt JSON with INVALID_PLAN', () => {
    expect(() => parseReceipt('{not json')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
    expect(() => parseReceipt('{"receiptVersion":"9"}')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PLAN' }),
    );
  });

  it('matches a receipt to the same plan and source, and rejects drift', () => {
    const receipt = buildReceipt({
      plan,
      source: { path: source.path, sizeBytes: source.sizeBytes },
      backend: { name: 'ffmpeg' },
      output: { path: '/media/out.mp4', sizeBytes: 50_000 },
      executedSteps: [],
      verification: verifyMedia({ ...source, path: '/media/out.mp4' }, plan.expectations),
    });
    expect(receiptMatches(receipt, plan, { path: source.path, sizeBytes: source.sizeBytes })).toBe(
      true,
    );
    expect(receiptMatches(receipt, plan, { path: source.path, sizeBytes: 999_999 })).toBe(false);
  });

  it('records failure state when execution failed', () => {
    const receipt = buildReceipt({
      plan,
      source: { path: source.path, sizeBytes: source.sizeBytes },
      backend: { name: 'ffmpeg' },
      output: { path: '/media/out.mp4', sizeBytes: 0 },
      executedSteps: [],
      verification: { passed: false, checks: {}, failures: ['x: failed'], warnings: [] },
      failure: { code: 'EXECUTION_FAILED', message: 'ffmpeg exited non-zero' },
    });
    expect(receipt.failure).toMatchObject({ code: 'EXECUTION_FAILED' });
    expect(receiptMatches(receipt, plan, { path: source.path, sizeBytes: source.sizeBytes })).toBe(
      false,
    );
  });
});

describe('extensible verification', () => {
  it('merges custom checks into the report', () => {
    const output: MediaMetadata = { ...source, path: '/media/out.mp4' };
    const report = verifyMedia(
      output,
      { audio: 'preserve' },
      {
        customChecks: [
          () => ({
            blackFrames: {
              passed: false,
              expected: 'no black frames',
              actual: '2s of black',
              message: 'Output contains black frames.',
            },
          }),
        ],
      },
    );
    expect(report.checks.blackFrames).toBeDefined();
    expect(report.failures.some((failure) => failure.startsWith('blackFrames'))).toBe(true);
    expect(report.passed).toBe(false);
  });

  it('downgrades warn-only checks to warnings that never fail the report', () => {
    const output: MediaMetadata = { ...source, path: '/media/out.mp4' };
    const report = verifyMedia(
      output,
      { audio: 'preserve' },
      {
        customChecks: [
          () => ({
            blackFrames: {
              passed: false,
              expected: 'no black frames',
              actual: '2s of black',
              message: 'Output contains black frames.',
            },
          }),
        ],
        warnOnly: ['blackFrames'],
      },
    );
    expect(report.passed).toBe(true);
    expect(report.warnings).toEqual(['blackFrames: Output contains black frames.']);
    expect(report.failures).toEqual([]);
  });

  it('isolates a throwing custom check as a warning', () => {
    const output: MediaMetadata = { ...source, path: '/media/out.mp4' };
    const report = verifyMedia(
      output,
      { audio: 'preserve' },
      {
        customChecks: [
          () => {
            throw new Error('boom');
          },
        ],
        warnOnly: ['customCheck'],
      },
    );
    expect(report.passed).toBe(true);
    expect(report.warnings.some((warning) => warning.startsWith('customCheck'))).toBe(true);
  });
});

describe('generated JSON Schema', () => {
  it('generates a valid JSON Schema for Media IR v1 from the Zod model', () => {
    expect(mediaPlanJsonSchema).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({
        irVersion: expect.anything(),
        steps: expect.anything(),
        expectations: expect.anything(),
      }),
    });
    const serialized = JSON.stringify(mediaPlanJsonSchema);
    expect(serialized).not.toContain('ZodError');
  });

  it('keeps the published docs schema in sync with the Zod model', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const { mediaPlanSchemaId } = await import('../src/schema.js');
    // Both published copies: the GitHub-hosted docs file the $id resolves to, and the one that
    // ships inside the package as the ./schema.json export.
    const publishedPaths = [
      resolve(__dirname, '../../../docs/media-plan.schema.json'),
      resolve(__dirname, '../schema/media-plan.schema.json'),
    ];
    for (const path of publishedPaths) {
      const published = JSON.parse(await readFile(path, 'utf8'));
      expect(published.$id, path).toBe(mediaPlanSchemaId);
      for (const [key, value] of Object.entries(mediaPlanJsonSchema)) {
        expect(published[key], `${path}: ${key}`).toEqual(value);
      }
    }
  });
});

describe('version boundaries', () => {
  it('rejects a plan declaring a different Media IR version', () => {
    expect(() =>
      validatePlan({
        irVersion: '2',
        source: { path: source.path },
        constraints: {},
        steps: [],
        expectations: {},
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'INVALID_PLAN',
        message: expect.stringContaining('is not supported'),
      }),
    );
    expect(MEDIA_IR_VERSION).toBe('1');
  });

  it('rejects a receipt declaring a different receipt version', () => {
    expect(() => validateReceipt({ receiptVersion: '9' })).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('is not supported') }),
    );
  });
});

describe('concatenation normalization', () => {
  const baseline: MediaMetadata = { ...source, path: '/media/a.mp4' };

  it('reports nothing when every clip already agrees', () => {
    const twin: MediaMetadata = { ...baseline, path: '/media/b.mp4' };
    expect(planConcatenationNormalization([baseline, twin])).toEqual([]);
  });

  it('plans a normalization pass for a clip with a different layout', () => {
    const odd: MediaMetadata = {
      ...baseline,
      path: '/media/odd.mp4',
      video: { width: 640, height: 360, aspectRatio: '16:9', codec: 'vp9', pixelFormat: 'yuv444p' },
    };
    const [normalization, ...rest] = planConcatenationNormalization([baseline, odd]);
    expect(rest).toEqual([]);
    expect(normalization?.input).toBe('/media/odd.mp4');
    expect(normalization?.differences).toEqual(
      expect.arrayContaining(['video.width', 'video.height', 'video.pixelFormat']),
    );
    expect(normalization?.plan.steps.map((step) => step.operation)).toEqual(['resize', 'encode']);
    expect(normalization?.plan.expectations).toMatchObject({ width: 320, height: 180 });
  });

  it('surfaces the conflict as a non-repairable plan issue with its normalization', () => {
    // Media IR requires the first concatenation input to be the plan source.
    const odd: MediaMetadata = { ...source, path: '/media/odd.mp4', audio: { present: false } };
    const plan = planWithSteps([
      {
        id: 'join',
        operation: 'concatenate',
        inputs: [source.path, '/media/odd.mp4'],
        reason: 'test',
      },
    ]);
    const [issue] = inspectPlanIssues(plan, source, {
      concatenationSources: [source, odd],
    });
    expect(issue).toMatchObject({ field: 'steps.join.inputs', repairable: false });
    expect(issue?.normalization?.[0]?.differences).toContain('audio.present');
  });
});

describe('aspect ratio verification', () => {
  const output = (width: number, height: number, ratio: string): MediaMetadata => ({
    ...source,
    path: '/media/out.mp4',
    video: { width, height, aspectRatio: ratio, codec: 'h264', pixelFormat: 'yuv420p' },
  });

  it('accepts the even-dimension crop a 9:16 request actually produces', () => {
    // 1920x1080 cropped to 9:16 wants 607.5px; encoders need even dimensions, so 606x1080.
    const report = verifyMedia(output(606, 1080, '101:180'), { aspectRatio: '9:16' });
    expect(report.passed).toBe(true);
  });

  it('still rejects a genuinely different ratio', () => {
    const report = verifyMedia(output(1440, 1080, '4:3'), { aspectRatio: '16:9' });
    expect(report.passed).toBe(false);
    expect(report.failures[0]).toContain('aspectRatio');
  });

  it('rejects an output with no video stream', () => {
    const audioOnly: MediaMetadata = {
      path: source.path,
      kind: 'audio',
      sizeBytes: source.sizeBytes,
      audio: source.audio,
    };
    const report = verifyMedia(audioOnly, { aspectRatio: '9:16' });
    expect(report.passed).toBe(false);
  });
});
