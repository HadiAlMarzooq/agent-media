import { z } from 'zod';

import { mediaPlanSchema } from './ir.js';

/**
 * Machine-consumable JSON Schema generated directly from the canonical Zod
 * Media IR models so agent tooling cannot drift from the runtime.
 */
export const mediaPlanJsonSchema: Record<string, unknown> = z.toJSONSchema(mediaPlanSchema, {
  io: 'output',
});

/**
 * Canonical schema identifier. Resolves to the generated schema file published
 * in this repository. The repository is private during pre-public development;
 * the URL becomes resolvable when the repository is made public.
 */
export const mediaPlanSchemaId =
  'https://raw.githubusercontent.com/HadiAlMarzooq/agent-media/main/docs/media-plan.schema.json';
