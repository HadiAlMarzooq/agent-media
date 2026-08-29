#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MediaError, parsePlan, planMedia, verifyMedia } from '@hadialmarzooq/agent-media-core';
import type { MediaGoals } from '@hadialmarzooq/agent-media-core';
import { executePlan, getCapabilities, inspectMedia } from '@hadialmarzooq/agent-media-ffmpeg';
import { z } from 'zod';

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
  const server = new McpServer({ name: 'agent-media', version: '0.0.6' });
  server.registerTool(
    'inspect_media',
    {
      description: 'Inspect normalized media metadata.',
      inputSchema: { input: z.string().min(1) },
    },
    async ({ input }) => result(await inspectMedia(input)),
  );
  server.registerTool(
    'get_media_capabilities',
    { description: 'Detect local FFmpeg capabilities.' },
    async () => result(await getCapabilities()),
  );
  server.registerTool(
    'plan_media',
    {
      description: 'Create an inspectable versioned semantic Media IR plan.',
      inputSchema: { input: z.string().min(1), goals: goalSchema },
    },
    async ({ input, goals }) =>
      result({
        plan: planMedia({
          source: await inspectMedia(input),
          goals: cleanGoals(goals),
          capabilities: await getCapabilities(),
        }),
      }),
  );
  server.registerTool(
    'execute_media_plan',
    {
      description: 'Execute a serialized semantic Media IR plan.',
      inputSchema: {
        plan: z.string().min(1),
        output: z.string().min(1),
        overwrite: z.boolean().optional(),
      },
    },
    async ({ plan: serialized, output, overwrite }) => {
      const plan = parsePlan(serialized);
      const execution = await executePlan(plan, {
        output,
        ...(overwrite === undefined ? {} : { overwrite }),
        sourceMetadata: await inspectMedia(plan.source.path),
      });
      return result({
        ...execution,
        verification: verifyMedia(await inspectMedia(execution.output), plan.expectations),
      });
    },
  );
  server.registerTool(
    'verify_media',
    {
      description: 'Verify output media against a serialized semantic Media IR plan.',
      inputSchema: { output: z.string().min(1), plan: z.string().min(1) },
    },
    async ({ output, plan: serialized }) =>
      result(verifyMedia(await inspectMedia(output), parsePlan(serialized).expectations)),
  );
  return server;
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
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
