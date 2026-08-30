#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  mediaPlanJsonSchema,
  mediaPlanSchemaId,
  mediaPlanSchemaVersion,
} from '../packages/core/dist/index.js';

// The docs copy is the GitHub-hosted URL the $id resolves to; the package copy ships inside
// @hadialmarzooq/agent-media-core so tooling can read it offline via the ./schema.json export.
const outputPaths = [
  resolve(process.argv[2] ?? 'docs/media-plan.schema.json'),
  resolve('packages/core/schema/media-plan.schema.json'),
];

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: mediaPlanSchemaId,
  title: `Agent Media Plan v${mediaPlanSchemaVersion}`,
  'x-media-ir-version': mediaPlanSchemaVersion,
  description:
    'Generated from the canonical Zod Media IR models. Do not edit by hand; regenerate with `node scripts/generate-schema.mjs`.',
  ...mediaPlanJsonSchema,
};

for (const outputPath of outputPaths) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  process.stdout.write(`Generated ${outputPath}\n`);
}
process.stdout.write(`$id: ${mediaPlanSchemaId}\n`);
