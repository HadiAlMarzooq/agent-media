import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getCapabilities, inspectMedia } from '../src/index.js';
import { runProcess } from '../src/process.js';

let directory = '';
let fixture = '';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-media-inspection-'));
  fixture = join(directory, 'fixture.mp4');
  const result = await runProcess('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:sample_rate=48000',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    fixture,
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('inspection', () => {
  it('normalizes metadata from real ffprobe output', async () => {
    const metadata = await inspectMedia(fixture);

    expect(metadata).toMatchObject({
      kind: 'video',
      container: 'mov',
      video: { width: 320, height: 180, aspectRatio: '16:9', fps: 30, codec: 'h264' },
      audio: { present: true, codec: 'aac', sampleRate: 48_000, channels: 1 },
    });
    expect(metadata.durationSeconds).toBeCloseTo(1, 1);
    expect(metadata.sizeBytes).toBeGreaterThan(0);
  });

  it('reports a stable missing-input error', async () => {
    await expect(inspectMedia(join(directory, 'missing.mp4'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_INPUT',
    });
  });

  it('detects installed FFmpeg capabilities', async () => {
    const capabilities = await getCapabilities();

    expect(capabilities.ffmpegVersion).not.toBe('unknown');
    expect(capabilities.filters.scale).toBe(true);
    expect(capabilities.filters.crop).toBe(true);
    expect(capabilities.encoders.aac).toBe(true);
  });
});
