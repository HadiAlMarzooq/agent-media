#!/usr/bin/env node
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  MediaError,
  parsePlan,
  planMedia,
  validatePlan,
  verifyMedia,
  inspectPlanIssues,
  repairPlan,
  parseReceipt,
  mediaPlanSchemaId,
  mediaPlanSchemaVersion,
} from '@hadialmarzooq/agent-media-core';
import type { MediaGoals, MediaMetadata, MediaPlan } from '@hadialmarzooq/agent-media-core';
import {
  concatenate,
  executePlan,
  extractAudio,
  resumeFromReceipt,
  extractFrame,
  getCapabilities,
  inspectMedia,
  makeVertical,
  normalize,
  optimizeForWeb,
} from '@hadialmarzooq/agent-media-ffmpeg';
import type { MediaProgress } from '@hadialmarzooq/agent-media-ffmpeg';
import { z } from 'zod';

const packageVersion = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version;

const goalSchema = z
  .object({
    trimStartSeconds: z.number().nonnegative().optional(),
    trimEndSeconds: z.number().finite().optional(),
    durationSeconds: z.number().positive().optional(),
    aspectRatio: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    maxSizeMB: z.number().positive().optional(),
    compatibility: z.enum(['high', 'balanced']).optional(),
    quality: z.enum(['high', 'balanced', 'small']).optional(),
    audio: z.enum(['preserve', 'remove']).optional(),
    extractAudio: z.object({ format: z.enum(['m4a', 'mp3', 'wav']).optional() }).optional(),
    extractFrame: z
      .object({
        atSeconds: z.number().nonnegative().optional(),
        format: z.enum(['jpg', 'png']).optional(),
      })
      .optional(),
    concatenate: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

function validateGoalSchema(goals: z.infer<typeof goalSchema>): z.infer<typeof goalSchema> {
  if (!Object.values(goals).some((v) => v !== undefined)) {
    throw new MediaError({
      code: 'INVALID_PLAN',
      message: 'At least one goal must be provided. An empty goals object produces a no-op plan.',
      suggestedActions: ['Provide at least one semantic goal.'],
    });
  }
  return goals;
}

// `irVersion` is accepted as any string here on purpose: the runtime's own boundary check reports
// an unsupported version by name, which is more useful than a schema mismatch on a literal.
const planRefSchema = z
  .object({ irVersion: z.string().min(1), source: z.object({ path: z.string() }) })
  .passthrough();

const videoStreamSchema = z.object({
  width: z.number(),
  height: z.number(),
  aspectRatio: z.string(),
  fps: z.number().optional(),
  codec: z.string().optional(),
  pixelFormat: z.string().optional(),
  rotationDegrees: z.number().optional(),
});

const mediaMetadataShape = {
  path: z.string(),
  kind: z.enum(['video', 'audio', 'image', 'unknown']),
  durationSeconds: z.number().optional(),
  container: z.string().optional(),
  sizeBytes: z.number(),
  video: videoStreamSchema.optional(),
  audio: z.object({
    present: z.boolean(),
    codec: z.string().optional(),
    sampleRate: z.number().optional(),
    channels: z.number().optional(),
  }),
};
const mediaMetadataSchema = z.object(mediaMetadataShape);

const verificationShape = {
  passed: z.boolean(),
  checks: z.record(
    z.string(),
    z.object({
      passed: z.boolean(),
      expected: z.unknown(),
      actual: z.unknown(),
      message: z.string(),
    }),
  ),
  failures: z.array(z.string()),
  warnings: z.array(z.string()),
};
const verificationSchema = z.object(verificationShape);

const planSchema = z.object({
  irVersion: z.literal('1'),
  source: z.object({ path: z.string() }),
  constraints: z.record(z.string(), z.unknown()),
  steps: z.array(z.record(z.string(), z.unknown())),
  expectations: z.record(z.string(), z.unknown()),
});

// `source` and `plan` are echoed for convenience and already carry a full schema on
// inspect_media and plan_media; repeating them on all six workflow tools tripled the cost of
// tools/list for no added type information.
const echoedObject = z.looseObject({});

// Receipts are fully specified by the core receipt schema. Restating them per tool would triple
// the cost of tools/list for type information a caller can get from inspect_receipt.
const receiptSchema = z.looseObject({ receiptVersion: z.string(), planFingerprint: z.string() });

const workflowResultShape = {
  source: echoedObject,
  plan: echoedObject,
  output: mediaMetadataSchema,
  verification: verificationSchema,
  resumed: z.boolean().optional(),
  receipt: receiptSchema.optional(),
};

const readOnlyHint = { readOnlyHint: true } as const;
const destructiveHint = { destructiveHint: true } as const;

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'agent-media', version: packageVersion });
  server.registerTool(
    'inspect_media',
    {
      description:
        'Inspect normalized media metadata. Paths resolve against the server working directory; absolute paths are recommended.',
      inputSchema: { input: z.string().min(1) },
      outputSchema: mediaMetadataShape,
      annotations: readOnlyHint,
    },
    async ({ input }) => safely(async () => inspectMedia(input)),
  );
  server.registerTool(
    'get_media_capabilities',
    {
      description: 'Detect local FFmpeg capabilities.',
      outputSchema: {
        ffmpegVersion: z.string(),
        encoders: z.object({
          h264: z.boolean(),
          hevc: z.boolean(),
          av1: z.boolean(),
          aac: z.boolean(),
        }),
        hardwareAcceleration: z.array(z.string()),
        filters: z.object({
          scale: z.boolean(),
          crop: z.boolean(),
          concat: z.boolean(),
          subtitles: z.boolean(),
        }),
      },
      annotations: readOnlyHint,
    },
    async () => safely(getCapabilities),
  );
  server.registerTool(
    'plan_media',
    {
      description: `Create an inspectable versioned semantic Media IR plan from semantic goals. All goals in the MediaGoals type are accepted. Plans conform to the canonical Media IR v${mediaPlanSchemaVersion} JSON Schema at ${mediaPlanSchemaId}, also returned by get_media_plan_schema.`,
      inputSchema: { input: z.string().min(1), goals: goalSchema },
      outputSchema: { plan: planSchema },
      annotations: readOnlyHint,
    },
    async ({ input, goals }) =>
      safely(async () => ({
        plan: planMedia({
          source: await inspectMedia(input),
          goals: cleanGoals(validateGoalSchema(goals)),
          capabilities: await getCapabilities(),
        }),
      })),
  );
  server.registerTool(
    'validate_plan',
    {
      description: `Detect mechanical plan issues (impossible trims, dimension conflicts, out-of-range timestamps, concatenation stream conflicts) against a real source without executing. Plans conform to the canonical Media IR v${mediaPlanSchemaVersion} JSON Schema at ${mediaPlanSchemaId}. Read-only.`,
      inputSchema: {
        plan: z.union([z.string().min(1), planRefSchema]),
      },
      outputSchema: {
        issues: z.array(
          z.object({
            field: z.string(),
            message: z.string(),
            repairable: z.boolean(),
            normalization: z
              .array(
                z.object({
                  input: z.string(),
                  differences: z.array(z.string()),
                  plan: planSchema,
                }),
              )
              .optional(),
          }),
        ),
      },
      annotations: readOnlyHint,
    },
    async ({ plan: input }) =>
      safely(async () => {
        const plan = normalizePlan(input);
        const source = await inspectMedia(plan.source.path);
        // A concatenation's conflicts live in the other clips, so they have to be inspected too;
        // otherwise a stream-layout mismatch stays invisible until FFmpeg refuses the join.
        const concatenationSources = await inspectConcatenationSources(plan, source);
        return {
          issues: inspectPlanIssues(plan, source, {
            ...(concatenationSources === undefined ? {} : { concatenationSources }),
          }),
        };
      }),
  );
  server.registerTool(
    'repair_plan',
    {
      description: `Repair mechanical plan issues (clamp trims and timestamps into source duration, reconcile resize with aspect ratio) and return the repaired plan with a structured repair report. Plans conform to the canonical Media IR v${mediaPlanSchemaVersion} JSON Schema at ${mediaPlanSchemaId}.`,
      inputSchema: {
        plan: z.union([z.string().min(1), planRefSchema]),
      },
      outputSchema: {
        repairs: z.array(
          z.object({
            field: z.string(),
            action: z.string(),
            from: z.unknown(),
            to: z.unknown(),
          }),
        ),
        repairedPlan: planSchema,
      },
      annotations: readOnlyHint,
    },
    async ({ plan: input }) =>
      safely(async () => {
        const plan = normalizePlan(input);
        const { plan: repaired, repairs } = repairPlan(plan, await inspectMedia(plan.source.path));
        return { repairs, repairedPlan: repaired };
      }),
  );
  server.registerTool(
    'get_media_plan_schema',
    {
      description: `Return the canonical Media Plan JSON Schema (Media IR v${mediaPlanSchemaVersion}, ${mediaPlanSchemaId}) generated from the runtime models, so agent tooling cannot drift.`,
      outputSchema: { $id: z.string(), schema: z.record(z.string(), z.unknown()) },
      annotations: readOnlyHint,
    },
    async () =>
      safely(async () => {
        const { mediaPlanJsonSchema } = await import('@hadialmarzooq/agent-media-core');
        return { $id: mediaPlanSchemaId, schema: mediaPlanJsonSchema };
      }),
  );
  server.registerTool(
    'make_vertical',
    {
      description:
        'Inspect, plan, execute, and verify a high-compatibility 9:16 video. Reports MCP progress when requested. Overwrite is destructive.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        trimStartSeconds: z.number().nonnegative().optional(),
        durationSeconds: z.number().positive().optional(),
        maxSizeMB: z.number().positive().optional(),
        audio: z.enum(['preserve', 'remove']).optional(),
        overwrite: z.boolean().optional(),
      },
      outputSchema: workflowResultShape,
      annotations: destructiveHint,
    },
    async (options, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () =>
        workflowResponse(
          await makeVertical({
            input: options.input,
            output: options.output,
            ...(options.width === undefined ? {} : { width: options.width }),
            ...(options.height === undefined ? {} : { height: options.height }),
            ...(options.trimStartSeconds === undefined
              ? {}
              : { trimStartSeconds: options.trimStartSeconds }),
            ...(options.durationSeconds === undefined
              ? {}
              : { durationSeconds: options.durationSeconds }),
            ...(options.maxSizeMB === undefined ? {} : { maxSizeMB: options.maxSizeMB }),
            ...(options.audio === undefined ? {} : { audio: options.audio }),
            ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
            signal: extra.signal,
            onProgress: notifications.notify,
          }),
        ),
      );
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'optimize_for_web',
    {
      description:
        'Inspect, plan, execute, and verify a web-optimized high-compatibility video. Reports MCP progress when requested. Overwrite is destructive.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        trimStartSeconds: z.number().nonnegative().optional(),
        durationSeconds: z.number().positive().optional(),
        maxSizeMB: z.number().positive().optional(),
        quality: z.enum(['high', 'balanced', 'small']).optional(),
        audio: z.enum(['preserve', 'remove']).optional(),
        overwrite: z.boolean().optional(),
      },
      outputSchema: workflowResultShape,
      annotations: destructiveHint,
    },
    async (options, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () =>
        workflowResponse(
          await optimizeForWeb({
            input: options.input,
            output: options.output,
            ...(options.trimStartSeconds === undefined
              ? {}
              : { trimStartSeconds: options.trimStartSeconds }),
            ...(options.durationSeconds === undefined
              ? {}
              : { durationSeconds: options.durationSeconds }),
            ...(options.maxSizeMB === undefined ? {} : { maxSizeMB: options.maxSizeMB }),
            ...(options.quality === undefined ? {} : { quality: options.quality }),
            ...(options.audio === undefined ? {} : { audio: options.audio }),
            ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
            signal: extra.signal,
            onProgress: notifications.notify,
          }),
        ),
      );
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'normalize_media',
    {
      description:
        'Inspect, plan, execute, and verify a normalized high-compatibility copy (H.264, yuv420p, faststart). Reports MCP progress when requested. Overwrite is destructive.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        trimStartSeconds: z.number().nonnegative().optional(),
        durationSeconds: z.number().positive().optional(),
        audio: z.enum(['preserve', 'remove']).optional(),
        overwrite: z.boolean().optional(),
      },
      outputSchema: workflowResultShape,
      annotations: destructiveHint,
    },
    async (options, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () =>
        workflowResponse(
          await normalize({
            input: options.input,
            output: options.output,
            ...(options.trimStartSeconds === undefined
              ? {}
              : { trimStartSeconds: options.trimStartSeconds }),
            ...(options.durationSeconds === undefined
              ? {}
              : { durationSeconds: options.durationSeconds }),
            ...(options.audio === undefined ? {} : { audio: options.audio }),
            ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
            signal: extra.signal,
            onProgress: notifications.notify,
          }),
        ),
      );
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'extract_audio',
    {
      description:
        'Extract and verify audio from any media source. Reports MCP progress when requested. Overwrite is destructive.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        format: z.enum(['m4a', 'mp3', 'wav']).optional(),
        trimStartSeconds: z.number().nonnegative().optional(),
        durationSeconds: z.number().positive().optional(),
        overwrite: z.boolean().optional(),
      },
      outputSchema: workflowResultShape,
      annotations: destructiveHint,
    },
    async (options, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () =>
        workflowResponse(
          await extractAudio({
            input: options.input,
            output: options.output,
            ...(options.format === undefined ? {} : { format: options.format }),
            ...(options.trimStartSeconds === undefined
              ? {}
              : { trimStartSeconds: options.trimStartSeconds }),
            ...(options.durationSeconds === undefined
              ? {}
              : { durationSeconds: options.durationSeconds }),
            ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
            signal: extra.signal,
            onProgress: notifications.notify,
          }),
        ),
      );
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'extract_frame',
    {
      description:
        'Extract and verify a still frame from a video source. The timestamp must be within the source duration. Reports MCP progress when requested. Overwrite is destructive.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        atSeconds: z.number().nonnegative().optional(),
        format: z.enum(['jpg', 'png']).optional(),
        overwrite: z.boolean().optional(),
      },
      outputSchema: workflowResultShape,
      annotations: destructiveHint,
    },
    async (options, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () =>
        workflowResponse(
          await extractFrame({
            input: options.input,
            output: options.output,
            ...(options.atSeconds === undefined ? {} : { atSeconds: options.atSeconds }),
            ...(options.format === undefined ? {} : { format: options.format }),
            ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
            signal: extra.signal,
            onProgress: notifications.notify,
          }),
        ),
      );
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'concatenate_media',
    {
      description:
        'Concatenate two or more media sources into a single verified output. Pass every clip in `inputs`, in playback order. All inputs must have compatible stream layouts. Reports MCP progress when requested. Overwrite is destructive.',
      inputSchema: {
        inputs: z
          .array(z.string().min(1))
          .min(2)
          .describe('Every clip to join, in playback order. The first entry leads the output.'),
        output: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
      outputSchema: workflowResultShape,
      annotations: destructiveHint,
    },
    async (options, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () =>
        workflowResponse(
          await concatenate({
            input: options.inputs[0] as string,
            inputs: options.inputs.slice(1),
            output: options.output,
            ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
            signal: extra.signal,
            onProgress: notifications.notify,
          }),
        ),
      );
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'execute_media_plan',
    {
      description: `Execute a serialized semantic Media IR plan conforming to the canonical Media IR v${mediaPlanSchemaVersion} JSON Schema at ${mediaPlanSchemaId}. Accepts a plan object or JSON string. Fails with VERIFICATION_FAILED when the output does not satisfy the plan. Overwrite is destructive. Set writeReceipt to emit a durable receipt, or resume to skip execution when a passing receipt already matches the plan and source.`,
      inputSchema: {
        plan: z.union([z.string().min(1), planRefSchema]),
        output: z.string().min(1),
        overwrite: z.boolean().optional(),
        writeReceipt: z.boolean().optional(),
        resume: z.boolean().optional(),
      },
      outputSchema: {
        output: z.string(),
        resumed: z.boolean().optional(),
        receipt: receiptSchema.optional(),
        verification: verificationSchema,
      },
      annotations: destructiveHint,
    },
    async ({ plan: input, output, overwrite, writeReceipt, resume }, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () => {
        const plan = normalizePlan(input);
        const execution = await executePlan(plan, {
          output,
          ...(overwrite === undefined ? {} : { overwrite }),
          ...(writeReceipt === undefined ? {} : { writeReceipt }),
          ...(resume === undefined ? {} : { resume }),
          signal: extra.signal,
          onProgress: notifications.notify,
        });
        // Execution already verified the output to build its receipt; a resumed run carries the
        // verification the receipt recorded. Only probe again if neither is present.
        const verification =
          execution.verification ??
          execution.receipt?.verification ??
          verifyMedia(await inspectMedia(execution.output), plan.expectations);
        // Match the workflow tools: an unverified artifact is a failed call, not a success
        // envelope carrying passed:false that a caller branching on isError would sail past.
        if (!verification.passed) {
          throw new MediaError({
            code: 'VERIFICATION_FAILED',
            message: 'The plan executed, but the output did not satisfy its expectations.',
            context: { output: execution.output, verification },
            suggestedActions: ['Inspect the failed checks, adjust the plan, and retry.'],
          });
        }
        return {
          output: execution.output,
          ...(execution.resumed === undefined ? {} : { resumed: execution.resumed }),
          ...(execution.receipt === undefined ? {} : { receipt: execution.receipt }),
          verification,
        };
      });
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'resume_execution',
    {
      description:
        'Continue from a saved execution receipt: skip the work when the recorded output still satisfies the same plan against an unchanged source, and re-execute the plan when it does not. Overwrite is destructive.',
      inputSchema: {
        receipt: z.string().min(1),
        output: z.string().min(1).optional(),
        overwrite: z.boolean().optional(),
      },
      outputSchema: {
        output: z.string(),
        resumed: z.boolean(),
        receipt: receiptSchema.optional(),
      },
      annotations: destructiveHint,
    },
    async ({ receipt, output, overwrite }, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () => {
        const execution = await resumeFromReceipt(parseReceipt(receipt), {
          ...(output === undefined ? {} : { output }),
          ...(overwrite === undefined ? {} : { overwrite }),
          signal: extra.signal,
          onProgress: notifications.notify,
        });
        return {
          output: execution.output,
          resumed: execution.resumed === true,
          ...(execution.receipt === undefined ? {} : { receipt: execution.receipt }),
        };
      });
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'inspect_receipt',
    {
      description:
        'Validate and inspect a saved execution receipt (durable record of plan, source fingerprint, output, and verification).',
      inputSchema: { receipt: z.string().min(1) },
      outputSchema: { receipt: receiptSchema },
      annotations: readOnlyHint,
    },
    async ({ receipt }) => safely(async () => ({ receipt: parseReceipt(receipt) })),
  );
  server.registerTool(
    'verify_media',
    {
      description:
        'Verify output media against a serialized semantic Media IR plan. Accepts a plan object or JSON string.',
      inputSchema: {
        output: z.string().min(1),
        plan: z.union([z.string().min(1), planRefSchema]),
      },
      outputSchema: verificationShape,
      annotations: readOnlyHint,
    },
    async ({ output, plan: input }) =>
      safely(async () => {
        const plan = normalizePlan(input);
        return verifyMedia(await inspectMedia(output), plan.expectations);
      }),
  );
  return server;
}

/**
 * Workflow results reach MCP without `serializedPlan`: it is a verbatim escaped copy of `plan`,
 * a third of the payload, and every tool that takes a plan accepts the object directly. SDK and
 * CLI callers still get it.
 */
function workflowResponse<T extends { serializedPlan?: string }>(
  result: T,
): Omit<T, 'serializedPlan'> {
  const rest = { ...result };
  delete rest.serializedPlan;
  return rest;
}

function result(value: unknown) {
  const content = [{ type: 'text' as const, text: JSON.stringify(value) }];
  // Tools declare an outputSchema, so every success also carries the typed object.
  return isPlainObject(value) ? { content, structuredContent: value } : { content };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safely(operation: () => Promise<unknown>) {
  try {
    return result(await operation());
  } catch (error) {
    const structured =
      error instanceof MediaError
        ? error.toJSON()
        : {
            code: 'UNEXPECTED_ERROR',
            message: error instanceof Error ? error.message : String(error),
          };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
      isError: true,
    };
  }
}

async function inspectConcatenationSources(
  plan: MediaPlan,
  source: MediaMetadata,
): Promise<MediaMetadata[] | undefined> {
  const concatenate = plan.steps.find((step) => step.operation === 'concatenate');
  if (concatenate?.operation !== 'concatenate') return undefined;
  const sources: MediaMetadata[] = [];
  for (const [index, input] of concatenate.inputs.entries()) {
    sources.push(index === 0 ? source : await inspectMedia(input));
  }
  return sources;
}

function normalizePlan(input: string | Record<string, unknown>): MediaPlan {
  return typeof input === 'string' ? parsePlan(input) : validatePlan(input);
}

function cleanGoals(goals: z.infer<typeof goalSchema>): MediaGoals {
  return cleanObject(goals) as MediaGoals;
}

function cleanObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

interface McpProgressContext {
  _meta?: { progressToken?: string | number | undefined } | undefined;
  sendNotification: (notification: {
    method: 'notifications/progress';
    params: {
      progressToken: string | number;
      progress: number;
      total: number;
      message: string;
    };
  }) => Promise<void>;
}

function mcpProgress(extra: McpProgressContext): {
  notify: (progress: MediaProgress) => void;
  drain: () => Promise<void>;
} {
  const progressToken = extra._meta?.progressToken;
  let pending = Promise.resolve();
  return {
    notify: (progress) => {
      if (progressToken === undefined) return;
      pending = pending
        .then(() =>
          extra.sendNotification({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: progress.percent,
              total: 100,
              message: `${progress.phase}: ${progress.message}`,
            },
          }),
        )
        .catch(() => undefined);
    },
    drain: () => pending,
  };
}
export async function startMcpServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}

if (isMainModule()) {
  startMcpServer().catch((error: unknown) => {
    const output =
      error instanceof MediaError
        ? error.toJSON()
        : {
            code: 'UNEXPECTED_ERROR',
            message: error instanceof Error ? error.message : String(error),
          };
    process.stderr.write(`${JSON.stringify(output)}\n`);
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
