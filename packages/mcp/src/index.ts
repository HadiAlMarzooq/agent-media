#!/usr/bin/env node
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  MediaError,
  mediaPlanSchema,
  parsePlan,
  planMedia,
  validatePlan,
  verifyMedia,
} from '@hadialmarzooq/agent-media-core';
import type { MediaGoals, MediaPlan } from '@hadialmarzooq/agent-media-core';
import {
  executePlan,
  getCapabilities,
  inspectMedia,
  makeVertical,
  optimizeForWeb,
  normalize,
  extractAudio,
  extractFrame,
} from '@hadialmarzooq/agent-media-ffmpeg';
import type { MediaProgress } from '@hadialmarzooq/agent-media-ffmpeg';
import { z } from 'zod';

const packageVersion = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version;

const goalSchema = z.object({
  trimStartSeconds: z.number().nonnegative().optional(),
  durationSeconds: z.number().positive().optional(),
  aspectRatio: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  maxSizeMB: z.number().positive().optional(),
  compatibility: z.enum(['high', 'balanced']).optional(),
  quality: z.enum(['high', 'balanced', 'small']).optional(),
  audio: z.enum(['preserve', 'remove']).optional(),
});

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'agent-media', version: packageVersion });
  server.registerTool(
    'inspect_media',
    {
      description: 'Inspect normalized media metadata.',
      inputSchema: { input: z.string().min(1) },
    },
    async ({ input }) => safely(async () => inspectMedia(input)),
  );
  server.registerTool(
    'get_media_capabilities',
    { description: 'Detect local FFmpeg capabilities.' },
    async () => safely(getCapabilities),
  );
  server.registerTool(
    'plan_media',
    {
      description: 'Create an inspectable versioned semantic Media IR plan.',
      inputSchema: { input: z.string().min(1), goals: goalSchema },
    },
    async ({ input, goals }) =>
      safely(async () => ({
        plan: planMedia({
          source: await inspectMedia(input),
          goals: cleanGoals(goals),
          capabilities: await getCapabilities(),
        }),
      })),
  );
  server.registerTool(
    'make_vertical',
    {
      description:
        'Inspect, plan, execute, and verify a high-compatibility 9:16 video. Reports MCP progress when requested.',
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
        'Inspect, plan, execute, and verify a web-optimized high-compatibility video. Reports MCP progress when requested.',
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
        'Inspect, plan, execute, and verify a normalized high-compatibility copy (H.264, yuv420p, faststart). Reports MCP progress when requested.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        trimStartSeconds: z.number().nonnegative().optional(),
        durationSeconds: z.number().positive().optional(),
        audio: z.enum(['preserve', 'remove']).optional(),
        overwrite: z.boolean().optional(),
      },
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
        'Extract and verify audio from any media source. Reports MCP progress when requested.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        format: z.enum(['m4a', 'mp3', 'wav']).optional(),
        trimStartSeconds: z.number().nonnegative().optional(),
        durationSeconds: z.number().positive().optional(),
        overwrite: z.boolean().optional(),
      },
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
        'Extract and verify a still frame from a video source. Reports MCP progress when requested.',
      inputSchema: {
        input: z.string().min(1),
        output: z.string().min(1),
        atSeconds: z.number().nonnegative().optional(),
        format: z.enum(['jpg', 'png']).optional(),
        overwrite: z.boolean().optional(),
      },
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
    'execute_media_plan',
    {
      description: 'Execute a serialized semantic Media IR plan.',
      inputSchema: {
        plan: z.union([z.string().min(1), mediaPlanSchema]),
        output: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
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
        return {
          output: execution.output,
          verification: verifyMedia(await inspectMedia(execution.output), plan.expectations),
        };
      });
      await notifications.drain();
      return response;
    },
  );
  server.registerTool(
    'verify_media',
    {
      description: 'Verify output media against a serialized semantic Media IR plan.',
      inputSchema: {
        output: z.string().min(1),
        plan: z.union([z.string().min(1), mediaPlanSchema]),
      },
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
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
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
    return { ...result(structured), isError: true };
  }
}

function normalizePlan(input: string | MediaPlan): MediaPlan {
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
