import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePlan, planMedia, serializePlan, verifyMedia } from '@hadialmarzooq/agent-media-core';

import { executePlan, inspectMedia, makeVertical } from '../src/index.js';
import type { MediaProgress } from '../src/index.js';
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
      kind: 'image',
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

  it('rejects incompatible concatenation streams before execution', async () => {
    const incompatible = join(directory, 'incompatible.mp4');
    const generated = await runProcess('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=size=640x360:rate=24',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-an',
      incompatible,
    ]);
    if (generated.exitCode !== 0) throw new Error(generated.stderr);

    const output = join(directory, 'incompatible-join.mp4');
    await expect(
      executePlan(planMedia({ source: metadata, goals: { concatenate: [incompatible] } }), {
        output,
        sourceMetadata: metadata,
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_INPUT',
      context: {
        inputIndex: 1,
        incompatibleFields: expect.arrayContaining([
          'video.width',
          'video.height',
          'video.fps',
          'audio.present',
        ]),
      },
    });
  });

  it('dogfoods a serialized vertical compatibility and size plan', async () => {
    const output = join(directory, 'dogfood.mp4');
    const plan = parsePlan(
      serializePlan(
        planMedia({
          source: metadata,
          goals: {
            trimStartSeconds: 0.25,
            durationSeconds: 1,
            aspectRatio: '9:16',
            width: 180,
            height: 320,
            compatibility: 'high',
            maxSizeMB: 0.15,
            audio: 'preserve',
          },
          capabilities: {
            ffmpegVersion: 'test',
            encoders: { h264: true, hevc: false, av1: false, aac: true },
            hardwareAcceleration: [],
            filters: { scale: true, crop: true, concat: true, subtitles: false },
          },
        }),
      ),
    );
    const progress: MediaProgress[] = [];
    await executePlan(plan, { output, onProgress: (event) => progress.push(event) });
    const transformed = await inspectMedia(output);

    expect(transformed).toMatchObject({
      kind: 'video',
      video: {
        width: 180,
        height: 320,
        aspectRatio: '9:16',
        codec: 'h264',
        pixelFormat: 'yuv420p',
      },
      audio: { present: true, codec: 'aac' },
    });
    expect(transformed.sizeBytes).toBeLessThanOrEqual(153_000);
    expect(verifyMedia(transformed, plan.expectations)).toMatchObject({ passed: true });
    expect(progress[0]).toMatchObject({ phase: 'executing', percent: 0 });
    expect(progress.at(-1)).toMatchObject({ phase: 'executing', percent: 100 });
    expect(
      progress.every(
        (event, index) => index === 0 || event.percent >= progress[index - 1]!.percent,
      ),
    ).toBe(true);
  });

  it('runs the makeVertical inspect-plan-execute-verify workflow', async () => {
    const output = join(directory, 'workflow.mp4');
    const progress: MediaProgress[] = [];
    const result = await makeVertical({
      input: fixture,
      output,
      width: 180,
      height: 320,
      durationSeconds: 1,
      maxSizeMB: 0.15,
      onProgress: (event) => progress.push(event),
    });

    expect(parsePlan(result.serializedPlan)).toEqual(result.plan);
    expect(result.output).toMatchObject({
      path: output,
      video: { width: 180, height: 320, aspectRatio: '9:16', codec: 'h264' },
    });
    expect(result.verification).toMatchObject({ passed: true });
    expect(progress.map((event) => event.phase)).toEqual(
      expect.arrayContaining(['inspecting', 'planning', 'executing', 'verifying', 'completed']),
    );
    expect(progress.at(-1)).toMatchObject({ phase: 'completed', percent: 100 });
  });
});
