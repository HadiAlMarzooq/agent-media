#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { parsePlan, planMedia, serializePlan, verifyMedia } from '../packages/core/dist/index.js';
import { executePlan, getCapabilities, inspectMedia } from '../packages/ffmpeg/dist/index.js';

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const workspace = await mkdtemp(join(tmpdir(), 'agent-media-demo-'));
const sourcePath = join(workspace, 'source.mp4');
const firstOutputPath = join(workspace, 'first-attempt.mp4');
const recoveredOutputPath = join(workspace, 'recovered.mp4');

function step(label) {
  process.stdout.write(`\n${BOLD}${CYAN}▶ ${label}${RESET}\n`);
}

function info(label, value) {
  process.stdout.write(`  ${DIM}${label}:${RESET} ${value}\n`);
}

function success(message) {
  process.stdout.write(`  ${GREEN}✓ ${message}${RESET}\n`);
}

function failure(message) {
  process.stdout.write(`  ${RED}✗ ${message}${RESET}\n`);
}

function warn(message) {
  process.stdout.write(`  ${YELLOW}⚠ ${message}${RESET}\n`);
}

async function generateSource(path) {
  const result = await run('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
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
    path,
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr);
}

function run(executable, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => resolveResult({ stdout, stderr, exitCode: exitCode ?? -1 }));
  });
}

process.stdout.write(
  `${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${RESET}\n`,
);
process.stdout.write(
  `${BOLD}${CYAN}║  Agent Media — Verified Recovery Demo                  ║${RESET}\n`,
);
process.stdout.write(
  `${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${RESET}\n`,
);

step('Generating test source video');
await generateSource(sourcePath);
success(`Created ${sourcePath.split('/').pop()}`);

step('Inspecting source media');
const source = await inspectMedia(sourcePath);
info('Kind', source.kind);
info('Dimensions', `${source.video?.width}x${source.video?.height}`);
info('Aspect Ratio', source.video?.aspectRatio);
info('Duration', `${source.durationSeconds}s`);
info('Audio', source.audio.present ? 'present' : 'absent');

step('Planning: 180×320 vertical, 1s, H.264, max 1 KB');
const capabilities = await getCapabilities();
const initialPlan = planMedia({
  source,
  capabilities,
  goals: {
    durationSeconds: 1,
    aspectRatio: '9:16',
    width: 180,
    height: 320,
    compatibility: 'high',
    maxSizeMB: 0.001,
    audio: 'preserve',
  },
});
info('Steps', initialPlan.steps.map((s) => s.operation).join(' → '));
info('Max size', `${initialPlan.expectations.maxSizeBytes} bytes`);
success('Plan created and validated (Media IR v1)');

step('Serializing and replaying plan (portable IR)');
const serialized = serializePlan(initialPlan);
info('Serialized', `${serialized.length} bytes JSON`);
const replayed = parsePlan(serialized);
success(`Replayed: IR v${replayed.irVersion}, ${replayed.steps.length} steps`);

step('Executing plan (attempt 1 — intentionally too small)');
const progress1 = [];
await executePlan(replayed, {
  output: firstOutputPath,
  sourceMetadata: source,
  overwrite: true,
  onProgress: (p) => {
    if (p.percent % 25 < 5) progress1.push(p.percent);
  },
});
const firstOutput = await inspectMedia(firstOutputPath);
info('Output size', `${firstOutput.sizeBytes} bytes`);
info('Progress', `0% → 100% (${progress1.length} events)`);

step('Verifying output against plan');
const failedVerification = verifyMedia(firstOutput, replayed.expectations);
if (failedVerification.passed) throw new Error('Expected failure');
failure('maxFileSize check failed');
info('Expected', failedVerification.checks.maxFileSize.expected);
info('Actual', failedVerification.checks.maxFileSize.actual);
warn('Structured error: VERIFICATION_FAILED');
warn('Suggested: Adjust semantic goals and retry');

step('Structured recovery — deriving feasible size constraint');
const sizeCheck = failedVerification.checks.maxFileSize;
const recoveredMaxSizeMB = Math.max(0.15, Math.ceil(sizeCheck.actual * 1.25) / 1_000_000);
info('Observed', `${sizeCheck.actual} bytes`);
info('New limit', `${recoveredMaxSizeMB} MB`);

step('Re-planning with recovered constraint');
const recoveredPlan = planMedia({
  source,
  capabilities,
  goals: {
    durationSeconds: 1,
    aspectRatio: '9:16',
    width: 180,
    height: 320,
    compatibility: 'high',
    maxSizeMB: recoveredMaxSizeMB,
    audio: 'preserve',
  },
});
const recoveredSerialized = serializePlan(recoveredPlan);
const replayedRecovered = parsePlan(recoveredSerialized);
success('New plan created, serialized, and replayed');

step('Executing recovered plan');
const progress2 = [];
await executePlan(replayedRecovered, {
  output: recoveredOutputPath,
  sourceMetadata: source,
  overwrite: true,
  onProgress: (p) => {
    if (p.percent % 25 < 5) progress2.push(p.percent);
  },
});
const recoveredOutput = await inspectMedia(recoveredOutputPath);
info('Output size', `${recoveredOutput.sizeBytes} bytes`);

step('Verifying recovered output');
const recoveredVerification = verifyMedia(recoveredOutput, replayedRecovered.expectations);
if (!recoveredVerification.passed) throw new Error('Recovery failed');
success('duration: satisfied');
success('aspectRatio: 9:16 ✓');
success('dimensions: 180×320 ✓');
success('maxFileSize: within limit ✓');
success('videoCodec: h264 ✓');
success('pixelFormat: yuv420p ✓');
success('audio: present ✓');

process.stdout.write(
  `\n${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${RESET}\n`,
);
process.stdout.write(
  `${BOLD}${GREEN}║  Recovery complete — 0 silent failures                 ║${RESET}\n`,
);
process.stdout.write(
  `${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${RESET}\n`,
);

await rm(workspace, { recursive: true, force: true });
