#!/usr/bin/env node
import { createRequire } from 'node:module';

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
import { executePlan, getCapabilities, inspectMedia } from '@hadialmarzooq/agent-media-ffmpeg';
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
    'execute_media_plan',
    {
      description: 'Execute a serialized semantic Media IR plan.',
      inputSchema: {
        plan: z.union([z.string().min(1), mediaPlanSchema]),
        output: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
    },
    async ({ plan: input, output, overwrite }) =>
      safely(async () => {
        const plan = normalizePlan(input);
        const execution = await executePlan(plan, {
          output,
          ...(overwrite === undefined ? {} : { overwrite }),
        });
        return {
          output: execution.output,
          verification: verifyMedia(await inspectMedia(execution.output), plan.expectations),
        };
      }),
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
  return Object.fromEntries(
    Object.entries(goals).filter(([, value]) => value !== undefined),
  ) as MediaGoals;
}
export async function startMcpServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
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
