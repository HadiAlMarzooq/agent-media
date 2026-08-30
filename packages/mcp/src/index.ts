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
} from '@hadialmarzooq/agent-media-core';
import type { MediaGoals, MediaPlan } from '@hadialmarzooq/agent-media-core';
import {
  concatenate,
  executePlan,
  extractAudio,
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

const planRefSchema = z
  .object({ irVersion: z.literal('1'), source: z.object({ path: z.string() }) })
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

const workflowResultShape = {
  source: echoedObject,
  plan: echoedObject,
  serializedPlan: z.string(),
  output: mediaMetadataSchema,
  verification: verificationSchema,
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
      description:
        'Create an inspectable versioned semantic Media IR plan from semantic goals. All goals in the MediaGoals type are accepted.',
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
        makeVertical({
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
        optimizeForWeb({
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
        normalize({
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
        extractAudio({
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
        extractFrame({
          input: options.input,
          output: options.output,
          ...(options.atSeconds === undefined ? {} : { atSeconds: options.atSeconds }),
          ...(options.format === undefined ? {} : { format: options.format }),
          ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
          signal: extra.signal,
          onProgress: notifications.notify,
        }),
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
        concatenate({
          input: options.inputs[0] as string,
          inputs: options.inputs.slice(1),
          output: options.output,
          ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
          signal: extra.signal,
          onProgress: notifications.notify,
        }),
      );
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'execute_media_plan',
    {
      description:
        'Execute a serialized semantic Media IR plan. Accepts a plan object or JSON string. Fails with VERIFICATION_FAILED when the output does not satisfy the plan. Overwrite is destructive.',
      inputSchema: {
        plan: z.union([z.string().min(1), planRefSchema]),
        output: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
      outputSchema: { output: z.string(), verification: verificationSchema },
      annotations: destructiveHint,
    },
    async ({ plan: input, output, overwrite }, extra) => {
      const notifications = mcpProgress(extra);
      const response = await safely(async () => {
        const plan = normalizePlan(input);
        const execution = await executePlan(plan, {
          output,
          ...(overwrite === undefined ? {} : { overwrite }),
          signal: extra.signal,
          onProgress: notifications.notify,
        });
        const verification = verifyMedia(await inspectMedia(execution.output), plan.expectations);
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
        return { output: execution.output, verification };
      });
      await notifications.drain();
      return response;
    },
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
