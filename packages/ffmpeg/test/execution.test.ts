import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parsePlan,
  parseReceipt,
  planMedia,
  serializePlan,
  verifyMedia,
} from '@hadialmarzooq/agent-media-core';

import {
  analyzeContent,
  resumeFromReceipt,
  concatenate,
  executePlan,
  inspectMedia,
  makeVertical,
  optimizeForWeb,
  normalize,
  extractAudio,
  extractFrame,
} from '../src/index.js';
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

  it('concatenates compatible video-only and audio-only sources', async () => {
    const videoOnly = join(directory, 'video-only.mp4');
    const audioOnly = join(directory, 'audio-only.m4a');
    const videoFixture = await runProcess('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=size=64x64:rate=10',
      '-t',
      '0.5',
      '-c:v',
      'libx264',
      '-an',
      videoOnly,
    ]);
    const audioFixture = await runProcess('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '0.5',
      '-c:a',
      'aac',
      audioOnly,
    ]);
    if (videoFixture.exitCode !== 0) throw new Error(videoFixture.stderr);
    if (audioFixture.exitCode !== 0) throw new Error(audioFixture.stderr);

    const videoMetadata = await inspectMedia(videoOnly);
    const audioMetadata = await inspectMedia(audioOnly);
    const joinedVideo = join(directory, 'joined-video-only.mp4');
    const joinedAudio = join(directory, 'joined-audio-only.m4a');
    await executePlan(planMedia({ source: videoMetadata, goals: { concatenate: [videoOnly] } }), {
      output: joinedVideo,
      sourceMetadata: videoMetadata,
    });
    await executePlan(planMedia({ source: audioMetadata, goals: { concatenate: [audioOnly] } }), {
      output: joinedAudio,
      sourceMetadata: audioMetadata,
    });

    await expect(inspectMedia(joinedVideo)).resolves.toMatchObject({
      kind: 'video',
      video: { width: 64, height: 64 },
      audio: { present: false },
    });
    await expect(inspectMedia(joinedAudio)).resolves.toMatchObject({
      kind: 'audio',
      audio: { present: true, codec: 'aac' },
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

  it('runs the optimizeForWeb inspect-plan-execute-verify workflow', async () => {
    const output = join(directory, 'web-optimized.mp4');
    const progress: MediaProgress[] = [];
    const result = await optimizeForWeb({
      input: fixture,
      output,
      durationSeconds: 1,
      maxSizeMB: 0.15,
      onProgress: (event) => progress.push(event),
    });

    expect(parsePlan(result.serializedPlan)).toEqual(result.plan);
    expect(result.output).toMatchObject({
      kind: 'video',
      video: { codec: 'h264', pixelFormat: 'yuv420p' },
    });
    expect(result.verification).toMatchObject({ passed: true });
    expect(progress.at(-1)).toMatchObject({ phase: 'completed', percent: 100 });
  });

  it('runs the normalize inspect-plan-execute-verify workflow', async () => {
    const output = join(directory, 'normalized.mp4');
    const result = await normalize({
      input: fixture,
      output,
      durationSeconds: 1,
    });

    expect(result.output).toMatchObject({
      kind: 'video',
      video: { codec: 'h264', pixelFormat: 'yuv420p' },
    });
    expect(result.verification).toMatchObject({ passed: true });
  });

  it('runs the extractAudio inspect-plan-execute-verify workflow', async () => {
    const output = join(directory, 'extracted-audio.m4a');
    const result = await extractAudio({
      input: fixture,
      output,
    });

    expect(result.output).toMatchObject({ kind: 'audio', audio: { present: true } });
    expect(result.verification).toMatchObject({ passed: true });
  });

  it('runs the extractFrame inspect-plan-execute-verify workflow', async () => {
    const output = join(directory, 'extracted-frame.jpg');
    const result = await extractFrame({
      input: fixture,
      output,
      atSeconds: 0.5,
    });

    expect(result.output).toMatchObject({ kind: 'image' });
    expect(result.verification).toMatchObject({ passed: true });
  });

  it('runs the concatenate workflow and produces a longer output', async () => {
    const output = join(directory, 'concat-workflow.mp4');
    const result = await concatenate({
      input: fixture,
      inputs: [fixture],
      output,
      overwrite: true,
    });

    expect(result.output.durationSeconds).toBeGreaterThan(3.5);
    expect(result.verification).toMatchObject({ passed: true });
  });

  it('rejects execution when the output directory does not exist', async () => {
    const output = join(directory, 'nonexistent', 'output.mp4');
    await expect(
      executePlan(planMedia({ source: metadata, goals: { compatibility: 'high' } }), {
        output,
        sourceMetadata: metadata,
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_DIR_MISSING' });
  });

  it('rejects output extension mismatch at plan time', async () => {
    const output = join(directory, 'wrong-ext.webm');
    await expect(
      executePlan(planMedia({ source: metadata, goals: { compatibility: 'high' } }), {
        output,
        sourceMetadata: metadata,
        overwrite: true,
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_EXTENSION_MISMATCH' });
  });

  it('reports the full resolved path when the input file does not exist', async () => {
    try {
      await inspectMedia(join(directory, 'totally-missing.mp4'));
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNSUPPORTED_INPUT' });
      expect(error).toMatchObject({
        context: { input: expect.stringContaining('totally-missing.mp4') },
      });
    }
  });

  it('writes a durable receipt and resumes idempotently from it', async () => {
    const output = join(directory, 'receipt.mp4');
    const plan = planMedia({
      source: metadata,
      goals: { compatibility: 'high', durationSeconds: 1 },
    });
    const first = await executePlan(plan, {
      output,
      sourceMetadata: metadata,
      writeReceipt: true,
    });

    expect(first.receipt).toMatchObject({
      receiptVersion: '1',
      verification: { passed: true },
    });
    await expect(accessFile(`${output}.receipt.json`)).resolves.toBeDefined();

    const second = await executePlan(plan, {
      output,
      sourceMetadata: metadata,
      resume: true,
    });
    expect(second.resumed).toBe(true);
    expect(second.receipt?.planFingerprint).toBe(first.receipt?.planFingerprint);
  });

  it('does not resume when the source changed', async () => {
    const output = join(directory, 'resume-drift.mp4');
    const plan = planMedia({
      source: metadata,
      goals: { compatibility: 'high', durationSeconds: 1 },
    });
    await executePlan(plan, { output, sourceMetadata: metadata, writeReceipt: true });

    const drifted: typeof metadata = { ...metadata, sizeBytes: metadata.sizeBytes + 1 };
    const rerun = await executePlan(plan, {
      output,
      sourceMetadata: drifted,
      overwrite: true,
      resume: true,
    });
    expect(rerun.resumed).toBeUndefined();
  });

  it('runs a workflow with writeReceipt and returns the receipt', async () => {
    const output = join(directory, 'workflow-receipt.mp4');
    const result = await makeVertical({
      input: fixture,
      output,
      width: 180,
      height: 320,
      durationSeconds: 1,
      writeReceipt: true,
    });
    expect(result.receipt).toMatchObject({ receiptVersion: '1', verification: { passed: true } });
    await expect(accessFile(`${output}.receipt.json`)).resolves.toBeDefined();
  });

  it('detects black frames and silence in the output content', async () => {
    const blackFixture = join(directory, 'black-silent.mp4');
    await runProcess('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:size=320x180:rate=30',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=mono:sample_rate=44100',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      blackFixture,
    ]);
    const checks = await analyzeContent(await inspectMedia(blackFixture), {
      blackFrames: true,
      silence: true,
      // The clip is only 2s, so the 2s default freeze window would never close on it.
      freeze: { minDurationSeconds: 0.5 },
      completeness: true,
    });
    expect(checks.blackFrames?.passed).toBe(false);
    expect(checks.silence?.passed).toBe(false);
    expect(checks.freeze?.passed).toBe(false);
    expect(checks.completeness?.passed).toBe(true);
  });

  it('passes content checks on real picture and sound', async () => {
    const checks = await analyzeContent(metadata, {
      blackFrames: true,
      silence: true,
      freeze: true,
      completeness: true,
    });
    for (const [name, check] of Object.entries(checks)) {
      expect(check.passed, `${name}: ${check.message} (${String(check.actual)})`).toBe(true);
    }
  });

  it('carries content checks into the workflow verification and receipt', async () => {
    const output = join(directory, 'content-checked.mp4');
    const result = await makeVertical({
      input: fixture,
      output,
      width: 180,
      height: 320,
      durationSeconds: 1,
      contentChecks: { blackFrames: true, completeness: true },
      writeReceipt: true,
    });
    expect(result.verification.checks.blackFrames).toBeDefined();
    expect(result.verification.checks.completeness).toBeDefined();
    expect(result.receipt?.verification.checks.blackFrames).toBeDefined();
  });

  it('reports a failing content check as a warning when it is warn-only', async () => {
    const output = join(directory, 'warn-only.mp4');
    const result = await makeVertical({
      input: fixture,
      output,
      width: 180,
      height: 320,
      durationSeconds: 1,
      contentChecks: { freeze: { minDurationSeconds: 0.1 } },
      warnOnly: ['freeze'],
      overwrite: true,
    });
    // testsrc2 does not freeze, so this asserts the wiring, not the detector.
    expect(result.verification.passed).toBe(true);
    expect(result.verification.warnings).toBeDefined();
  });

  it('records a failure receipt when execution fails', async () => {
    const output = join(directory, 'failed.mp4');
    const plan = planMedia({ source: metadata, goals: { compatibility: 'high' } });
    await expect(
      executePlan(plan, {
        output,
        sourceMetadata: metadata,
        writeReceipt: true,
        ffmpegPath: '/nonexistent/ffmpeg',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'FFMPEG_NOT_FOUND' }));

    const { readFile } = await import('node:fs/promises');
    const receipt = parseReceipt(await readFile(`${output}.receipt.json`, 'utf8'));
    expect(receipt.failure?.code).toBe('FFMPEG_NOT_FOUND');
    expect(receipt.verification.passed).toBe(false);
    expect(receipt.executedSteps).toEqual([]);
  });

  it('does not resume from a failure receipt', async () => {
    const output = join(directory, 'failed-resume.mp4');
    const plan = planMedia({
      source: metadata,
      goals: { compatibility: 'high', durationSeconds: 1 },
    });
    await expect(
      executePlan(plan, {
        output,
        sourceMetadata: metadata,
        writeReceipt: true,
        ffmpegPath: '/nonexistent/ffmpeg',
      }),
    ).rejects.toThrow();

    const rerun = await executePlan(plan, { output, sourceMetadata: metadata, resume: true });
    expect(rerun.resumed).toBeUndefined();
    expect(rerun.verification?.passed).toBe(true);
  });

  it('resumes from a saved receipt without re-encoding', async () => {
    const output = join(directory, 'resume-from-receipt.mp4');
    const plan = planMedia({
      source: metadata,
      goals: { compatibility: 'high', durationSeconds: 1 },
    });
    const first = await executePlan(plan, { output, sourceMetadata: metadata, writeReceipt: true });
    expect(first.resumed).toBeUndefined();

    const { readFile, stat } = await import('node:fs/promises');
    const before = await stat(output);
    const receipt = parseReceipt(await readFile(`${output}.receipt.json`, 'utf8'));
    const resumed = await resumeFromReceipt(receipt);
    const after = await stat(output);

    expect(resumed.resumed).toBe(true);
    expect(resumed.output).toBe(output);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('re-executes through resumeFromReceipt when the output no longer exists', async () => {
    const output = join(directory, 'resume-missing-output.mp4');
    const plan = planMedia({
      source: metadata,
      goals: { compatibility: 'high', durationSeconds: 1 },
    });
    await executePlan(plan, { output, sourceMetadata: metadata, writeReceipt: true });

    const { readFile, rm: remove } = await import('node:fs/promises');
    const receipt = parseReceipt(await readFile(`${output}.receipt.json`, 'utf8'));
    await remove(output);

    const rerun = await resumeFromReceipt(receipt);
    expect(rerun.resumed).toBeUndefined();
    await expect(accessFile(output)).resolves.toBe(output);
  });
});

async function accessFile(path: string): Promise<string> {
  const { access } = await import('node:fs/promises');
  await access(path);
  return path;
}
