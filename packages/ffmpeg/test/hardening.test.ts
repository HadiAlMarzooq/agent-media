import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executePlan, inspectMedia } from '../src/index.js';
import { runProcess } from '../src/process.js';

let directory = '';
let fixture = '';
let metadata: Awaited<ReturnType<typeof inspectMedia>>;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-media-hardening-'));
  fixture = join(directory, 'fixture.mp4');
  const generated = await runProcess('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=size=16x16:rate=1',
    '-t',
    '1',
    fixture,
  ]);
  if (generated.exitCode !== 0) throw new Error(generated.stderr);
  metadata = await inspectMedia(fixture);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const plan = () => ({
  irVersion: '1' as const,
  source: { path: fixture },
  constraints: {},
  steps: [
    { id: 'encode', operation: 'encode' as const, profile: 'balanced' as const, reason: 'test' },
  ],
  expectations: {},
});

describe('execution hardening', () => {
  it('classifies process timeouts', async () => {
    const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], 10);
    expect(result.timedOut).toBe(true);
  });

  it('prevents source overwrite and output escape', async () => {
    await expect(
      executePlan(plan(), { output: fixture, sourceMetadata: metadata, overwrite: true }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' });
    await expect(
      executePlan(plan(), {
        output: join(tmpdir(), 'outside.mp4'),
        sourceMetadata: metadata,
        allowedOutputDirectory: directory,
      }),
    ).rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' });
  });

  it('preserves output collision safety', async () => {
    const existing = join(directory, 'existing.mp4');
    await copyFile(fixture, existing);
    await expect(
      executePlan(plan(), { output: existing, sourceMetadata: metadata }),
    ).rejects.toMatchObject({
      code: 'OUTPUT_EXISTS',
    });
  });
});
