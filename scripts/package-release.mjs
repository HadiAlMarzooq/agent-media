import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDirectory = join(workspace, 'artifacts', 'release');
const expectedReleaseDirectory = resolve(workspace, 'artifacts', 'release');
if (resolve(releaseDirectory) !== expectedReleaseDirectory) {
  throw new Error(
    'Refusing to prepare release artifacts outside the expected workspace directory.',
  );
}

const packageDirectories = ['core', 'ffmpeg', 'cli', 'mcp'];
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const packages = [];
for (const directory of packageDirectories) {
  const packagePath = join(workspace, 'packages', directory, 'package.json');
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
  await command('pnpm', [
    '--filter',
    metadata.name,
    'pack',
    '--pack-destination',
    releaseDirectory,
  ]);

  const expectedFile = `${metadata.name.slice(1).replace('/', '-')}-${metadata.version}.tgz`;
  const tarballPath = join(releaseDirectory, expectedFile);
  const archiveEntries = (await command('tar', ['-tzf', tarballPath])).stdout.trim().split(/\r?\n/);
  for (const required of [
    'package/package.json',
    'package/dist/index.js',
    'package/dist/index.d.ts',
  ]) {
    if (!archiveEntries.includes(required)) {
      throw new Error(`${expectedFile} is missing required release file ${required}.`);
    }
  }
  if (archiveEntries.some((entry) => /(?:^|\/)(?:src|test)(?:\/|$)/.test(entry))) {
    throw new Error(`${expectedFile} contains source or test files outside the package contract.`);
  }

  const packedMetadata = JSON.parse(
    (await command('tar', ['-xOzf', tarballPath, 'package/package.json'])).stdout,
  );
  if (packedMetadata.name !== metadata.name || packedMetadata.version !== metadata.version) {
    throw new Error(`${expectedFile} package identity does not match its workspace manifest.`);
  }
  const dependencyEntries = Object.entries(packedMetadata.dependencies ?? {});
  if (dependencyEntries.some(([, version]) => String(version).startsWith('workspace:'))) {
    throw new Error(`${expectedFile} leaked a workspace dependency into the release package.`);
  }

  const contents = await readFile(tarballPath);
  packages.push({
    name: metadata.name,
    version: metadata.version,
    file: expectedFile,
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  });
}

const actualTarballs = (await readdir(releaseDirectory)).filter((file) => file.endsWith('.tgz'));
if (actualTarballs.length !== packageDirectories.length) {
  throw new Error(
    `Expected ${packageDirectories.length} tarballs; found ${actualTarballs.length}.`,
  );
}

const commit =
  process.env.GITHUB_SHA ??
  (await command('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout.trim();
const manifest = {
  schemaVersion: 1,
  releaseTag: process.env.RELEASE_TAG ?? null,
  commit,
  generatedAt: new Date().toISOString(),
  packages,
};
await writeFile(
  join(releaseDirectory, 'release-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
await writeFile(
  join(releaseDirectory, 'SHA256SUMS.txt'),
  `${packages.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
  'utf8',
);

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);

function command(executable, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd ?? workspace,
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
