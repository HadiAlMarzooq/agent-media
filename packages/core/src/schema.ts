import { z } from 'zod';

import { MEDIA_IR_VERSION, mediaPlanSchema } from './ir.js';

/**
 * Machine-consumable JSON Schema generated directly from the canonical Zod
 * Media IR models so agent tooling cannot drift from the runtime.
 */
export const mediaPlanJsonSchema: Record<string, unknown> = z.toJSONSchema(mediaPlanSchema, {
  io: 'output',
});

export const mediaPlanSchemaVersion = MEDIA_IR_VERSION;

/**
 * Canonical schema identifier. Resolves to the generated schema file published
 * in this repository.
 */
export const mediaPlanSchemaId =
  'https://raw.githubusercontent.com/HadiAlMarzooq/agent-media/main/docs/media-plan.schema.json';
