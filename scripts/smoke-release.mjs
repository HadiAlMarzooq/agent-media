import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const releaseDirectory = resolve(process.argv[2] ?? 'artifacts/release');
const tarballs = (await readdir(releaseDirectory))
  .filter((file) => file.endsWith('.tgz'))
  .sort()
  .map((file) => join(releaseDirectory, file));
if (tarballs.length !== 4)
  throw new Error(`Expected four release tarballs; found ${tarballs.length}.`);

const project = await mkdtemp(join(tmpdir(), 'agent-media-release-smoke-'));
try {
  await writeFile(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'agent-media-release-smoke', private: true, type: 'module' }, null, 2)}\n`,
    'utf8',
  );
  await command('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
    ...tarballs,
  ]);

  const core = await importInstalled('@hadialmarzooq/agent-media-core');
  const ffmpeg = await importInstalled('@hadialmarzooq/agent-media-ffmpeg');
  const mcp = await importInstalled('@hadialmarzooq/agent-media-mcp');
  for (const [name, value] of [
    ['planMedia', core.planMedia],
    ['verifyMedia', core.verifyMedia],
    ['executePlan', ffmpeg.executePlan],
    ['makeVertical', ffmpeg.makeVertical],
    ['createMcpServer', mcp.createMcpServer],
  ]) {
    if (typeof value !== 'function') throw new Error(`Installed bundle does not export ${name}.`);
  }

  const cliManifest = JSON.parse(
    await readFile(
      join(project, 'node_modules', '@hadialmarzooq', 'agent-media-cli', 'package.json'),
      'utf8',
    ),
  );
  const cliPath = join(
    project,
    'node_modules',
    '@hadialmarzooq',
    'agent-media-cli',
    'dist',
    'index.js',
  );
  const cli = await command(process.execPath, [cliPath, '--version']);
  if (cli.stdout.trim() !== cliManifest.version) {
    throw new Error(
      `Installed CLI reported ${cli.stdout.trim()} instead of ${cliManifest.version}.`,
    );
  }

  process.stdout.write(
    `${JSON.stringify({ passed: true, tarballs: tarballs.length, cliVersion: cliManifest.version })}\n`,
  );
} finally {
  await rm(project, { recursive: true, force: true });
}

async function importInstalled(packageName) {
  const path = join(project, 'node_modules', ...packageName.split('/'), 'dist', 'index.js');
  return import(pathToFileURL(path).href);
}

function command(executable, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode === 0) resolveResult({ stdout, stderr });
      else reject(new Error(`${executable} exited ${exitCode}: ${stderr || stdout}`));
    });
  });
}
