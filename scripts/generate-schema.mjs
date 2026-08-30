#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { mediaPlanJsonSchema, mediaPlanSchemaId } from '../packages/core/dist/index.js';

const outputPath = resolve(process.argv[2] ?? 'docs/media-plan.schema.json');

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: mediaPlanSchemaId,
  title: 'Agent Media Plan v1',
  description:
    'Generated from the canonical Zod Media IR models. Do not edit by hand; regenerate with `node scripts/generate-schema.mjs`.',
  ...mediaPlanJsonSchema,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
process.stdout.write(`Generated ${outputPath}\n$id: ${mediaPlanSchemaId}\n`);
