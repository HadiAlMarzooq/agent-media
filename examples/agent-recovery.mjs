import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { parsePlan, planMedia, serializePlan, verifyMedia } from '../packages/core/dist/index.js';
import { executePlan, getCapabilities, inspectMedia } from '../packages/ffmpeg/dist/index.js';

const outputDirectory = resolve(argument('--output-dir') ?? 'artifacts/demo');
await mkdir(outputDirectory, { recursive: true });

const sourcePath = join(outputDirectory, 'source.mp4');
const firstOutputPath = join(outputDirectory, 'first-attempt.mp4');
const recoveredOutputPath = join(outputDirectory, 'recovered.mp4');
const initialPlanPath = join(outputDirectory, 'initial-plan.json');
const recoveredPlanPath = join(outputDirectory, 'recovered-plan.json');
const transcriptPath = join(outputDirectory, 'transcript.json');
const transcript = [];

await generateSource(sourcePath);
record('agent_request', {
  goal: 'Create a 180x320 vertical clip, preserve audio, and keep it under 1 KB.',
});

const source = await inspectMedia(sourcePath);
record('inspect', { source });

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
record('create_plan', { plan: initialPlan });

const serializedInitialPlan = serializePlan(initialPlan);
await writeFile(initialPlanPath, `${serializedInitialPlan}\n`, 'utf8');
record('serialize_plan', {
  path: initialPlanPath,
  bytes: Buffer.byteLength(serializedInitialPlan),
});

const replayedInitialPlan = parsePlan(serializedInitialPlan);
record('replay_plan', {
  irVersion: replayedInitialPlan.irVersion,
  stepIds: replayedInitialPlan.steps.map((step) => step.id),
});

const firstProgress = [];
await executePlan(replayedInitialPlan, {
  output: firstOutputPath,
  sourceMetadata: source,
  overwrite: true,
  onProgress: (progress) => firstProgress.push(progress),
});
const firstOutput = await inspectMedia(firstOutputPath);
record('execute_plan', {
  output: firstOutput,
  progress: summarizeProgress(firstProgress),
});

const failedVerification = verifyMedia(firstOutput, replayedInitialPlan.expectations);
if (failedVerification.passed) {
  throw new Error('The demonstration expected the intentionally impossible 1 KB check to fail.');
}
record('verify_failed', { report: failedVerification });

const sizeCheck = failedVerification.checks.maxFileSize;
if (sizeCheck?.passed !== false || typeof sizeCheck.actual !== 'number') {
  throw new Error('The failed verification did not contain a structured maximum-size check.');
}
const recoveredMaxSizeMB = Math.max(0.15, Math.ceil(sizeCheck.actual * 1.25) / 1_000_000);
record('structured_recovery', {
  trigger: 'maxFileSize',
  observedBytes: sizeCheck.actual,
  previousLimitBytes: sizeCheck.expected,
  decision: 'Create a new plan with a feasible, explicit size ceiling and replay it.',
  recoveredMaxSizeMB,
});

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
const serializedRecoveredPlan = serializePlan(recoveredPlan);
await writeFile(recoveredPlanPath, `${serializedRecoveredPlan}\n`, 'utf8');
const replayedRecoveredPlan = parsePlan(serializedRecoveredPlan);
record('serialize_and_replay_recovery', {
  path: recoveredPlanPath,
  irVersion: replayedRecoveredPlan.irVersion,
  maxSizeBytes: replayedRecoveredPlan.expectations.maxSizeBytes,
});

const recoveredProgress = [];
await executePlan(replayedRecoveredPlan, {
  output: recoveredOutputPath,
  sourceMetadata: source,
  overwrite: true,
  onProgress: (progress) => recoveredProgress.push(progress),
});
const recoveredOutput = await inspectMedia(recoveredOutputPath);
const recoveredVerification = verifyMedia(recoveredOutput, replayedRecoveredPlan.expectations);
if (!recoveredVerification.passed) {
  throw new Error(`Structured recovery failed: ${recoveredVerification.failures.join(' ')}`);
}
record('verify_recovered', {
  output: recoveredOutput,
  progress: summarizeProgress(recoveredProgress),
  report: recoveredVerification,
});

const result = {
  demo: 'agent-plan-replay-verify-recover',
  passed: true,
  artifacts: {
    initialPlan: initialPlanPath,
    failedOutput: firstOutputPath,
    recoveredPlan: recoveredPlanPath,
    recoveredOutput: recoveredOutputPath,
    transcript: transcriptPath,
  },
  transcript,
};
await writeFile(transcriptPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function record(event, data) {
  transcript.push({ sequence: transcript.length + 1, event, data });
}

function summarizeProgress(events) {
  return {
    events: events.length,
    firstPercent: events[0]?.percent,
    lastPercent: events.at(-1)?.percent,
    monotonic: events.every(
      (event, index) => index === 0 || event.percent >= events[index - 1].percent,
    ),
  };
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
