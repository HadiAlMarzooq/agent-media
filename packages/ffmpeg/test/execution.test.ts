import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyMedia } from '@agent-media/core';

import { executePlan, inspectMedia } from '../src/index.js';
import { runProcess } from '../src/process.js';

let directory = '';
let fixture = '';
let metadata: Awaited<ReturnType<typeof inspectMedia>>;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-media-execution-'));
  fixture = join(directory, 'fixture.mp4');
  const generated = await runProcess('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    fixture,
  ]);
  if (generated.exitCode !== 0) throw new Error(generated.stderr);
  metadata = await inspectMedia(fixture);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('execution', () => {
  it('executes trim, reframe, resize and encode semantics', async () => {
    const output = join(directory, 'vertical.mp4');
    await executePlan(
      {
        irVersion: '1',
        source: { path: fixture },
        constraints: {},
        steps: [
          { id: 'trim', operation: 'trim', startSeconds: 0, endSeconds: 1, reason: 'test' },
          {
            id: 'reframe',
            operation: 'reframe',
            aspectRatio: '9:16',
            strategy: 'center',
            reason: 'test',
          },
          { id: 'resize', operation: 'resize', width: 180, height: 320, reason: 'test' },
          { id: 'encode', operation: 'encode', profile: 'high-compatibility', reason: 'test' },
        ],
        expectations: { durationSeconds: 1, aspectRatio: '9:16', width: 180, height: 320 },
      },
      { output, sourceMetadata: metadata },
    );
    const transformed = await inspectMedia(output);
    expect(transformed).toMatchObject({
      video: { width: 180, height: 320, aspectRatio: '9:16' },
    });
    expect(
      verifyMedia(transformed, {
        durationSeconds: 1,
        aspectRatio: '9:16',
        width: 180,
        height: 320,
      }),
    ).toMatchObject({ passed: true });
  });

  it('extracts audio and a still frame', async () => {
    const audio = join(directory, 'audio.m4a');
    const frame = join(directory, 'frame.jpg');
    await executePlan(
      {
        irVersion: '1',
        source: { path: fixture },
        constraints: {},
        steps: [{ id: 'audio', operation: 'extract-audio', format: 'm4a', reason: 'test' }],
        expectations: { audio: 'required' },
      },
      { output: audio, sourceMetadata: metadata },
    );
    await executePlan(
      {
        irVersion: '1',
        source: { path: fixture },
        constraints: {},
        steps: [
          { id: 'frame', operation: 'extract-frame', atSeconds: 0, format: 'jpg', reason: 'test' },
        ],
        expectations: {},
      },
      { output: frame, sourceMetadata: metadata },
    );
    await expect(inspectMedia(audio)).resolves.toMatchObject({
      kind: 'audio',
      audio: { present: true },
    });
    await expect(inspectMedia(frame)).resolves.toMatchObject({
      kind: 'video',
      video: { width: 320, height: 180 },
    });
  });

  it('concatenates compatible sources', async () => {
    const output = join(directory, 'joined.mp4');
    await executePlan(
      {
        irVersion: '1',
        source: { path: fixture },
        constraints: {},
        steps: [
          { id: 'join', operation: 'concatenate', inputs: [fixture, fixture], reason: 'test' },
        ],
        expectations: {},
      },
      { output, sourceMetadata: metadata },
    );
    await expect(inspectMedia(output)).resolves.toMatchObject({ kind: 'video' });
  });
});
