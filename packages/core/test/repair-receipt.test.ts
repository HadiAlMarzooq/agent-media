import { describe, expect, it } from 'vitest';

import {
  buildReceipt,
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
    const matching = planWithSteps([
      {
        id: 'reframe',
        operation: 'reframe',
        aspectRatio: '9:16',
        strategy: 'center',
        reason: 'test',
      },
      { id: 'resize', operation: 'resize', width: 90, height: 160, reason: 'test' },
    ]);
    expect(inspectPlanIssues(matching, source)).toEqual([]);

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
    const issues = inspectPlanIssues(mismatched, source);
    expect(issues.some((issue) => issue.message.includes('1:1'))).toBe(true);

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
    const docsPath = resolve(__dirname, '../../../docs/media-plan.schema.json');
    const published = JSON.parse(await readFile(docsPath, 'utf8'));
    expect(published.$id).toBe(mediaPlanSchemaId);
    for (const [key, value] of Object.entries(mediaPlanJsonSchema)) {
      expect(published[key]).toEqual(value);
    }
  });
});
