import { z } from 'zod';

import { MediaError } from './errors.js';

/** The Media IR version this runtime speaks. Plans declaring anything else are rejected. */
export const MEDIA_IR_VERSION = '1' as const;

export const aspectRatioSchema = z
  .string()
  .regex(/^[1-9]\d*:[1-9]\d*$/, 'Aspect ratio must use positive width:height values.');

const stepBase = z.object({ id: z.string().min(1), reason: z.string().min(1) });

export const mediaStepSchema = z.discriminatedUnion('operation', [
  stepBase.extend({
    operation: z.literal('trim'),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().positive().optional(),
  }),
  stepBase.extend({
    operation: z.literal('reframe'),
    aspectRatio: aspectRatioSchema,
    strategy: z.enum(['center']).default('center'),
  }),
  stepBase.extend({
    operation: z.literal('resize'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  stepBase.extend({
    operation: z.literal('encode'),
    profile: z.enum(['high-compatibility', 'balanced', 'high-quality']),
    maxSizeMB: z.number().positive().optional(),
  }),
  stepBase.extend({
    operation: z.literal('extract-audio'),
    format: z.enum(['m4a', 'mp3', 'wav']).default('m4a'),
  }),
  stepBase.extend({
    operation: z.literal('extract-frame'),
    atSeconds: z.number().nonnegative(),
    format: z.enum(['jpg', 'png']).default('jpg'),
  }),
  stepBase.extend({
    operation: z.literal('concatenate'),
    inputs: z.array(z.string().min(1)).min(2),
  }),
]);

export const expectationsSchema = z.object({
  durationSeconds: z.number().positive().optional(),
  aspectRatio: aspectRatioSchema.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  maxSizeBytes: z.number().positive().optional(),
  audio: z.enum(['preserve', 'remove', 'required']).optional(),
  container: z.string().min(1).optional(),
  videoCodec: z.string().min(1).optional(),
  pixelFormat: z.string().min(1).optional(),
});

/** Version 1 of the portable, semantic media plan. */
export const mediaPlanSchema = z
  .object({
    irVersion: z.literal(MEDIA_IR_VERSION),
    source: z.object({ path: z.string().min(1) }),
    constraints: z.object({
      maxSizeMB: z.number().positive().optional(),
      compatibility: z.enum(['high', 'balanced']).optional(),
      quality: z.enum(['high', 'balanced', 'small']).optional(),
    }),
    steps: z.array(mediaStepSchema),
    expectations: expectationsSchema,
  })
  .superRefine((plan, context) => {
    const ids = new Set<string>();
    const operations = new Set<string>();
    const order = new Map([
      ['trim', 0],
      ['reframe', 1],
      ['resize', 2],
      ['encode', 3],
    ]);
    let previousOrder = -1;
    for (const [index, step] of plan.steps.entries()) {
      if (ids.has(step.id)) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'id'],
          message: `Step id must be unique: ${step.id}.`,
        });
      }
      ids.add(step.id);
      if (operations.has(step.operation)) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'operation'],
          message: `Media IR v1 allows at most one ${step.operation} step.`,
        });
      }
      operations.add(step.operation);

      const stepOrder = order.get(step.operation);
      if (stepOrder !== undefined && stepOrder < previousOrder) {
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'operation'],
          message: 'Transform steps must be ordered as trim, reframe, resize, then encode.',
        });
      }
      if (stepOrder !== undefined) previousOrder = stepOrder;
    }

    const terminalSteps = plan.steps.filter((step) =>
      ['extract-audio', 'extract-frame', 'concatenate'].includes(step.operation),
    );
    if (terminalSteps.length > 0 && plan.steps.length > 1) {
      context.addIssue({
        code: 'custom',
        path: ['steps'],
        message:
          'Extraction and concatenation operations cannot be combined with other steps in Media IR v1.',
      });
    }

    const concatenate = terminalSteps.find((step) => step.operation === 'concatenate');
    if (concatenate?.operation === 'concatenate' && concatenate.inputs[0] !== plan.source.path) {
      context.addIssue({
        code: 'custom',
        path: ['steps', plan.steps.indexOf(concatenate), 'inputs', 0],
        message: 'The first concatenation input must match the Media Plan source.',
      });
    }

    const encode = plan.steps.find((step) => step.operation === 'encode');
    if (plan.constraints.maxSizeMB !== undefined) {
      if (encode?.operation !== 'encode' || encode.maxSizeMB !== plan.constraints.maxSizeMB) {
        context.addIssue({
          code: 'custom',
          path: ['constraints', 'maxSizeMB'],
          message: 'Maximum-size constraints require a matching encode step.',
        });
      }
      if (plan.expectations.maxSizeBytes !== plan.constraints.maxSizeMB * 1_000_000) {
        context.addIssue({
          code: 'custom',
          path: ['expectations', 'maxSizeBytes'],
          message: 'Maximum-size constraints require a matching byte expectation.',
        });
      }
    }
    if (plan.constraints.compatibility === 'high') {
      if (encode?.operation !== 'encode' || encode.profile !== 'high-compatibility') {
        context.addIssue({
          code: 'custom',
          path: ['constraints', 'compatibility'],
          message: 'High compatibility requires a high-compatibility encode step.',
        });
      }
      if (plan.expectations.videoCodec !== 'h264' || plan.expectations.pixelFormat !== 'yuv420p') {
        context.addIssue({
          code: 'custom',
          path: ['expectations'],
          message: 'High compatibility requires H.264 and yuv420p verification expectations.',
        });
      }
    }
  });

export type MediaStep = z.infer<typeof mediaStepSchema>;
export type MediaExpectations = z.infer<typeof expectationsSchema>;
export type MediaPlan = z.infer<typeof mediaPlanSchema>;

export function serializePlan(plan: MediaPlan): string {
  return JSON.stringify(validatePlan(plan), null, 2);
}

export function parsePlan(serialized: string): MediaPlan {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw invalidPlan('Media Plan is not valid JSON.', error);
  }
  return validatePlan(value);
}

/** Validate an unknown value at a public Media IR boundary. */
export function validatePlan(value: unknown): MediaPlan {
  assertSupportedVersion(value);
  const parsed = mediaPlanSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidPlan(
      `Media Plan does not match Media IR version ${MEDIA_IR_VERSION}.`,
      parsed.error,
    );
  }
  return parsed.data;
}

/**
 * A plan carrying a different IR version is rejected before schema validation, so the caller is
 * told the runtime speaks a different version rather than reading a list of field-level errors.
 */
function assertSupportedVersion(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  const declared = (value as { irVersion?: unknown }).irVersion;
  if (declared === undefined || declared === MEDIA_IR_VERSION) return;
  throw new MediaError({
    code: 'INVALID_PLAN',
    message: `Media IR version ${String(declared)} is not supported by this runtime.`,
    context: { declaredVersion: declared, supportedVersion: MEDIA_IR_VERSION },
    suggestedActions: [
      `Re-plan the transformation with a runtime that emits Media IR version ${MEDIA_IR_VERSION}.`,
    ],
  });
}

function invalidPlan(message: string, error: unknown): MediaError {
  return new MediaError({
    code: 'INVALID_PLAN',
    message,
    context: {
      issues:
        error instanceof z.ZodError
          ? error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
          : [
              {
                path: '',
                message: error instanceof Error ? error.message : String(error),
              },
            ],
    },
    suggestedActions: ['Create or serialize the plan with the Agent Media planning API.'],
  });
}
