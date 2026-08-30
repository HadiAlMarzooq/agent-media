import { z } from 'zod';

import { MediaError } from './errors.js';
import { mediaPlanSchema } from './ir.js';
import type { MediaPlan } from './ir.js';
import type { VerificationReport } from './verification.js';

/** Fingerprint of the source a plan was executed against. */
export const sourceFingerprintSchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().positive().optional(),
  container: z.string().min(1).optional(),
  videoCodec: z.string().min(1).optional(),
});

export type SourceFingerprint = z.infer<typeof sourceFingerprintSchema>;

/** Durable, versioned receipt emitted after an execution and its verification. */
export const executionReceiptSchema = z.object({
  receiptVersion: z.literal('1'),
  plan: mediaPlanSchema,
  planFingerprint: z.string().min(1),
  source: sourceFingerprintSchema,
  backend: z.object({
    name: z.string().min(1),
    capabilities: z.record(z.string(), z.unknown()).optional(),
  }),
  executedAt: z.string().min(1),
  output: z.object({
    path: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    durationSeconds: z.number().positive().optional(),
  }),
  executedSteps: z.array(z.string().min(1)),
  verification: z.object({
    passed: z.boolean(),
    checks: z.record(z.string(), z.unknown()),
    failures: z.array(z.string()),
    warnings: z.array(z.string()).optional(),
  }),
  failure: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
});

export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>;

export interface BuildReceiptInput {
  plan: MediaPlan;
  source: SourceFingerprint;
  backend: { name: string; capabilities?: Record<string, unknown> };
  output: { path: string; sizeBytes: number; durationSeconds?: number };
  executedSteps: string[];
  verification: VerificationReport;
  failure?: { code: string; message: string };
}

/** Build a durable receipt after execution and verification complete. */
export function buildReceipt(input: BuildReceiptInput): ExecutionReceipt {
  return executionReceiptSchema.parse({
    receiptVersion: '1',
    plan: input.plan,
    planFingerprint: planFingerprint(input.plan),
    source: input.source,
    backend: input.backend,
    executedAt: new Date().toISOString(),
    output: input.output,
    executedSteps: input.executedSteps,
    verification: {
      passed: input.verification.passed,
      checks: input.verification.checks,
      failures: input.verification.failures,
      ...(input.verification.warnings === undefined || input.verification.warnings.length === 0
        ? {}
        : { warnings: input.verification.warnings }),
    },
    ...(input.failure === undefined ? {} : { failure: input.failure }),
  });
}

/** Parse and validate a serialized receipt at a public boundary. */
export function parseReceipt(value: string): ExecutionReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new MediaError({
      code: 'INVALID_PLAN',
      message: 'Execution receipt is not valid JSON.',
      context: { cause: error instanceof Error ? error.message : String(error) },
      suggestedActions: ['Load a receipt produced by Agent Media execution.'],
    });
  }
  return validateReceipt(parsed);
}

export const RECEIPT_VERSION = '1' as const;

export function validateReceipt(value: unknown): ExecutionReceipt {
  if (typeof value === 'object' && value !== null) {
    const declared = (value as { receiptVersion?: unknown }).receiptVersion;
    if (declared !== undefined && declared !== RECEIPT_VERSION) {
      throw new MediaError({
        code: 'INVALID_PLAN',
        message: `Execution receipt version ${String(declared)} is not supported by this runtime.`,
        context: { declaredVersion: declared, supportedVersion: RECEIPT_VERSION },
        suggestedActions: [`Re-run the execution to produce a version ${RECEIPT_VERSION} receipt.`],
      });
    }
  }
  const result = executionReceiptSchema.safeParse(value);
  if (!result.success) {
    throw new MediaError({
      code: 'INVALID_PLAN',
      message: 'Execution receipt does not match receipt version 1.',
      context: {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      suggestedActions: ['Load a receipt produced by Agent Media execution.'],
    });
  }
  return result.data;
}

/** A stable fingerprint of plan semantics, independent of execution bytes. */
export function planFingerprint(plan: MediaPlan): string {
  const semantic = JSON.stringify({
    irVersion: plan.irVersion,
    source: plan.source,
    steps: plan.steps.map((step) => ({ ...step, reason: undefined })),
    expectations: plan.expectations,
    constraints: plan.constraints,
  });
  let hash = 5381;
  for (let index = 0; index < semantic.length; index++) {
    hash = ((hash << 5) + hash + semantic.charCodeAt(index)) | 0;
  }
  return `plan-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Whether a receipt authorizes skipping re-execution for the same plan and source. */
export function receiptMatches(
  receipt: ExecutionReceipt,
  plan: MediaPlan,
  source: SourceFingerprint,
): boolean {
  return (
    receipt.planFingerprint === planFingerprint(plan) &&
    receipt.source.path === source.path &&
    receipt.source.sizeBytes === source.sizeBytes &&
    receipt.verification.passed === true &&
    receipt.failure === undefined
  );
}
