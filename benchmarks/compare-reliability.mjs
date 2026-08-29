import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'artifacts/reliability');
const files = (await readdir(directory, { recursive: true }))
  .filter((path) => path.endsWith('.json'))
  .map((path) => resolve(directory, path));

if (files.length < 2) {
  throw new Error(`Expected at least two platform reports in ${directory}; found ${files.length}.`);
}

const reports = await Promise.all(
  files.map(async (path) => ({ path, report: JSON.parse(await readFile(path, 'utf8')) })),
);
for (const { path, report } of reports) {
  if (report.summary?.failed !== 0)
    throw new Error(`Reliability failures were recorded in ${path}.`);
}

const fingerprints = new Set(reports.map(({ report }) => report.semanticFingerprint));
if (fingerprints.size !== 1) {
  const evidence = reports
    .map(({ path, report }) => `${path}: ${report.semanticFingerprint}`)
    .join('\n');
  throw new Error(`Cross-platform semantic fingerprints differ:\n${evidence}`);
}

process.stdout.write(
  `Cross-platform reliability matched for ${reports.length} reports: ${[...fingerprints][0]}\n`,
);
