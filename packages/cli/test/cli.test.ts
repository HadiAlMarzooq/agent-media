import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProgram } from '../src/index.js';

const execFileAsync = promisify(execFile);
let directory = '';
let fixture = '';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-media-cli-'));
  fixture = join(directory, 'fixture.mp4');
  await execFileAsync('ffmpeg', [
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
    'sine=frequency=1000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    fixture,
  ]);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('CLI', () => {
  it('defines the semantic command surface', () => {
    expect(createProgram().commands.map((command) => command.name())).toEqual([
      'inspect',
      'capabilities',
      'plan',
      'execute',
      'verify',
    ]);
  });

  it('dogfoods plan, serialized execution, and verification with real FFmpeg', async () => {
    const planPath = join(directory, 'plan.json');
    const output = join(directory, 'vertical.mp4');

    const planned = await runCli([
      'plan',
      fixture,
      '--trim-start',
      '0.25',
      '--duration',
      '1',
      '--aspect',
      '9:16',
      '--width',
      '180',
      '--height',
      '320',
      '--compatibility',
      'high',
      '--out',
      planPath,
    ]);
    expect(planned).toMatchObject({
      irVersion: '1',
      expectations: { durationSeconds: 1, aspectRatio: '9:16', width: 180, height: 320 },
    });
    expect(JSON.parse(await readFile(planPath, 'utf8'))).toEqual(planned);

    const executed = await runCli(['execute', planPath, '--output', output]);
    expect(executed).toMatchObject({ output, verification: { passed: true } });

    const verified = await runCli(['verify', output, '--against', planPath]);
    expect(verified).toMatchObject({ passed: true });
  });

  it('returns a structured error for an invalid media source', async () => {
    await expect(
      createProgram().parseAsync(['inspect', join(directory, 'missing.mp4')], { from: 'user' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_INPUT' });
  });
});

async function runCli(args: string[]): Promise<Record<string, unknown>> {
  let output = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    await createProgram().parseAsync(args, { from: 'user' });
  } finally {
    write.mockRestore();
  }
  return JSON.parse(output) as Record<string, unknown>;
}
