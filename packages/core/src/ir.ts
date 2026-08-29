import { z } from 'zod';

export const aspectRatioSchema = z
  .string()
  .regex(/^\d+:\d+$/, 'Aspect ratio must use the form width:height.')
  .refine(
    (value) => value.split(':').every((part) => Number(part) > 0),
    'Aspect ratio values must be positive.',
  );

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
});

/** Version 1 of the portable, semantic media plan. */
export const mediaPlanSchema = z.object({
  irVersion: z.literal('1'),
  source: z.object({ path: z.string().min(1) }),
  constraints: z.object({
    maxSizeMB: z.number().positive().optional(),
    compatibility: z.enum(['high', 'balanced']).optional(),
    quality: z.enum(['high', 'balanced', 'small']).optional(),
  }),
  steps: z.array(mediaStepSchema),
  expectations: expectationsSchema,
});

export type MediaStep = z.infer<typeof mediaStepSchema>;
export type MediaExpectations = z.infer<typeof expectationsSchema>;
export type MediaPlan = z.infer<typeof mediaPlanSchema>;

export function serializePlan(plan: MediaPlan): string {
  return JSON.stringify(mediaPlanSchema.parse(plan), null, 2);
}

export function parsePlan(serialized: string): MediaPlan {
  return mediaPlanSchema.parse(JSON.parse(serialized));
}
