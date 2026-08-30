import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import { MediaError, planMedia, verifyMedia } from '../packages/core/dist/index.js';
import {
  executePlan,
  getCapabilities,
  inspectMedia,
  makeVertical,
  optimizeForWeb,
  normalize,
  extractAudio,
  extractFrame,
} from '../packages/ffmpeg/dist/index.js';

const workspace = await mkdtemp(join(tmpdir(), 'agent-media-reliability-'));
const outputPath = resolve(
  argument('--output') ?? `artifacts/reliability/${process.platform}-${process.arch}.json`,
);
const cases = [];

try {
  const source = join(workspace, 'source.mp4');
  const audioOnly = join(workspace, 'audio-only.wav');
  const incompatible = join(workspace, 'incompatible.mp4');
  const malformed = join(workspace, 'malformed.mp4');

  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:sample_rate=48000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    source,
  ]);
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', audioOnly]);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=size=640x360:rate=24',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    incompatible,
  ]);
  await writeFile(malformed, 'this is not a media container', 'utf8');

  await benchmark('size-limit', async () => {
    const target = join(workspace, 'size-limited.mp4');
    const result = await makeVertical({
      input: source,
      output: target,
      width: 180,
      height: 320,
      durationSeconds: 1,
      maxSizeMB: 0.15,
    });
    if (!result.verification.passed || result.output.sizeBytes > 153_000) {
      throw new Error('The encoded result exceeded its verified size contract.');
    }
    return {
      verificationPassed: true,
      withinSizeLimit: true,
      aspectRatio: result.output.video?.aspectRatio,
      dimensions: `${result.output.video?.width}x${result.output.video?.height}`,
      videoCodec: result.output.video?.codec,
      pixelFormat: result.output.video?.pixelFormat,
      audioPresent: result.output.audio.present,
    };
  });

  await benchmark('malformed-file', async () => {
    const error = await expectedMediaError(() => inspectMedia(malformed));
    if (error.code !== 'PROBE_FAILED') throw error;
    return { errorCode: error.code, structuredRecovery: Boolean(error.suggestedActions?.length) };
  });

  await benchmark('audio-only-vertical-rejection', async () => {
    const error = await expectedMediaError(() =>
      makeVertical({
        input: audioOnly,
        output: join(workspace, 'impossible-vertical.mp4'),
        width: 180,
        height: 320,
      }),
    );
    if (error.code !== 'INVALID_PLAN') throw error;
    return { errorCode: error.code, structuredRecovery: Boolean(error.suggestedActions?.length) };
  });

  await benchmark('incompatible-concatenation', async () => {
    const metadata = await inspectMedia(source);
    const plan = planMedia({ source: metadata, goals: { concatenate: [incompatible] } });
    const error = await expectedMediaError(() =>
      executePlan(plan, {
        output: join(workspace, 'incompatible-join.mp4'),
        sourceMetadata: metadata,
      }),
    );
    if (error.code !== 'UNSUPPORTED_INPUT') throw error;
    const fields = Array.isArray(error.context?.incompatibleFields)
      ? [...error.context.incompatibleFields].map(String).sort()
      : [];
    if (!fields.includes('audio.present') || !fields.includes('video.width')) {
      throw new Error('The preflight result did not identify the incompatible streams.');
    }
    return { errorCode: error.code, incompatibleFields: fields };
  });

  await benchmark('trim-duration-verification', async () => {
    const target = join(workspace, 'trimmed.mp4');
    const plan = planMedia({
      source: await inspectMedia(source),
      goals: { trimStartSeconds: 0, durationSeconds: 1, compatibility: 'high' },
    });
    await executePlan(plan, { output: target, sourceMetadata: await inspectMedia(source) });
    const output = await inspectMedia(target);
    const verification = verifyMedia(output, plan.expectations);
    if (!verification.passed) throw new Error('Trim duration verification failed.');
    return { durationSeconds: output.durationSeconds, expected: 1 };
  });

  await benchmark('square-reframe-verification', async () => {
    const target = join(workspace, 'square.mp4');
    const plan = planMedia({
      source: await inspectMedia(source),
      goals: { aspectRatio: '1:1', width: 180, height: 180, compatibility: 'high' },
    });
    await executePlan(plan, { output: target, sourceMetadata: await inspectMedia(source) });
    const output = await inspectMedia(target);
    const verification = verifyMedia(output, plan.expectations);
    if (!verification.passed) throw new Error('Square reframe verification failed.');
    return {
      aspectRatio: output.video?.aspectRatio,
      dimensions: `${output.video?.width}x${output.video?.height}`,
    };
  });

  await benchmark('audio-extraction-verification', async () => {
    const target = join(workspace, 'extracted.m4a');
    const result = await extractAudio({ input: source, output: target });
    if (!result.verification.passed) throw new Error('Audio extraction verification failed.');
    return { kind: result.output.kind, audioPresent: result.output.audio.present };
  });

  await benchmark('frame-extraction-verification', async () => {
    const target = join(workspace, 'frame.jpg');
    const result = await extractFrame({ input: source, output: target, atSeconds: 0.5 });
    if (!result.verification.passed) throw new Error('Frame extraction verification failed.');
    return {
      kind: result.output.kind,
      dimensions: `${result.output.video?.width}x${result.output.video?.height}`,
    };
  });

  await benchmark('web-optimization-verification', async () => {
    const target = join(workspace, 'web-optimized.mp4');
    const result = await optimizeForWeb({
      input: source,
      output: target,
      durationSeconds: 1,
      maxSizeMB: 0.15,
    });
    if (!result.verification.passed) throw new Error('Web optimization verification failed.');
    return {
      videoCodec: result.output.video?.codec,
      pixelFormat: result.output.video?.pixelFormat,
      sizeBytes: result.output.sizeBytes,
    };
  });

  await benchmark('normalize-verification', async () => {
    const target = join(workspace, 'normalized.mp4');
    const result = await normalize({ input: source, output: target, durationSeconds: 1 });
    if (!result.verification.passed) throw new Error('Normalize verification failed.');
    return {
      videoCodec: result.output.video?.codec,
      pixelFormat: result.output.video?.pixelFormat,
    };
  });

  await benchmark('output-collision-rejection', async () => {
    const target = join(workspace, 'collision.mp4');
    await makeVertical({
      input: source,
      output: target,
      width: 180,
      height: 320,
      durationSeconds: 1,
    });
    const error = await expectedMediaError(() =>
      makeVertical({ input: source, output: target, width: 180, height: 320, durationSeconds: 1 }),
    );
    if (error.code !== 'OUTPUT_EXISTS') throw error;
    return { errorCode: error.code, structuredRecovery: Boolean(error.suggestedActions?.length) };
  });

  await benchmark('source-overwrite-rejection', async () => {
    const metadata = await inspectMedia(source);
    const plan = planMedia({ source: metadata, goals: { compatibility: 'high' } });
    const error = await expectedMediaError(() =>
      executePlan(plan, { output: source, sourceMetadata: metadata }),
    );
    if (error.code !== 'PATH_NOT_ALLOWED') throw error;
    return { errorCode: error.code, structuredRecovery: Boolean(error.suggestedActions?.length) };
  });

  await benchmark('compatible-concatenation', async () => {
    const target = join(workspace, 'compatible-join.mp4');
    const metadata = await inspectMedia(source);
    const plan = planMedia({ source: metadata, goals: { concatenate: [source] } });
    await executePlan(plan, { output: target, sourceMetadata: metadata });
    const output = await inspectMedia(target);
    if (output.durationSeconds === undefined || output.durationSeconds < 3.5) {
      throw new Error('Concatenation did not produce a longer output.');
    }
    return { durationSeconds: output.durationSeconds, kind: output.kind };
  });

  const capabilities = await getCapabilities();
  const semanticResults = Object.fromEntries(
    cases.map(({ id, passed, evidence }) => [id, { passed, evidence }]),
  );
  const semanticFingerprint = createHash('sha256')
    .update(JSON.stringify(semanticResults))
    .digest('hex');
  const failed = cases.filter((entry) => !entry.passed).length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      ffmpegVersion: capabilities.ffmpegVersion,
    },
    summary: { total: cases.length, passed: cases.length - failed, failed },
    semanticFingerprint,
    cases,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function benchmark(id, operation) {
  const started = performance.now();
  try {
    const evidence = await operation();
    cases.push({ id, passed: true, durationMs: rounded(performance.now() - started), evidence });
  } catch (error) {
    cases.push({
      id,
      passed: false,
      durationMs: rounded(performance.now() - started),
      evidence: structuredError(error),
    });
  }
}

async function expectedMediaError(operation) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof MediaError) return error;
    throw error;
  }
  throw new Error('Expected a structured MediaError, but the operation succeeded.');
}

function structuredError(error) {
  return error instanceof MediaError
    ? error.toJSON()
    : { message: error instanceof Error ? error.message : String(error) };
}

async function ffmpeg(args) {
  const result = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

function run(executable, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => resolveResult({ stdout, stderr, exitCode: exitCode ?? -1 }));
  });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}
