#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';

const execFileAsync = promisify(execFile);

const MAX_BYTES = {
  '@hadialmarzooq/agent-media-core': 50_000,
  '@hadialmarzooq/agent-media-ffmpeg': 50_000,
  '@hadialmarzooq/agent-media-cli': 30_000,
  '@hadialmarzooq/agent-media-mcp': 30_000,
};

const workspace = resolve('.');
const reportPath = resolve(argument('--output') ?? 'artifacts/package-sizes/report.json');

const packages = [];
const tmp = await mkdtemp(join(tmpdir(), 'pkg-size-'));

try {
  for (const dir of ['packages/core', 'packages/ffmpeg', 'packages/cli', 'packages/mcp']) {
    const pkgPath = join(workspace, dir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    const { stdout } = await execFileAsync('pnpm', ['pack', '--pack-destination', tmp], {
      cwd: join(workspace, dir),
    });
    const tarballPath = stdout.trim().split('\n').pop();
    const { size: packedBytes } = await stat(tarballPath);
    const tarballName = tarballPath.split('/').pop();

    const { stdout: listing } = await execFileAsync('tar', ['-tzf', tarballPath]);
    const files = listing
      .trim()
      .split('\n')
      .map((f) => f.replace(/^package\//, ''))
      .filter((f) => f !== '' && f !== '.');

    const limit = MAX_BYTES[pkg.name] ?? 50_000;
    packages.push({
      name: pkg.name,
      version: pkg.version,
      tarball: tarballName,
      packedBytes,
      fileCount: files.length,
      limit,
      withinLimit: packedBytes <= limit,
      files,
    });
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}

const report = {
  generatedAt: new Date().toISOString(),
  packages,
  summary: {
    total: packages.length,
    withinLimit: packages.filter((p) => p.withinLimit).length,
    overLimit: packages.filter((p) => !p.withinLimit).length,
    totalPackedBytes: packages.reduce((sum, p) => sum + p.packedBytes, 0),
  },
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const formatBytes = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

process.stdout.write('\nPackage Size Report\n');
process.stdout.write('─'.repeat(72) + '\n');
for (const pkg of packages) {
  const status = pkg.withinLimit ? '✓' : '✗ OVER LIMIT';
  process.stdout.write(
    `  ${pkg.name.padEnd(42)} ${formatBytes(pkg.packedBytes).padStart(10)}  / ${formatBytes(pkg.limit).padStart(8)}  ${pkg.fileCount} files  ${status}\n`,
  );
}
process.stdout.write('─'.repeat(72) + '\n');
process.stdout.write(
  `  Total: ${formatBytes(report.summary.totalPackedBytes)} across ${packages.length} packages\n\n`,
);

if (report.summary.overLimit > 0) {
  process.stderr.write(`${report.summary.overLimit} package(s) exceed their size limit.\n`);
  process.exitCode = 1;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
