import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpServer } from '../src/index.js';

const execFileAsync = promisify(execFile);
let directory = '';
let fixture = '';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-media-mcp-'));
  fixture = join(directory, 'fixture.mp4');
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    fixture,
  ]);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('MCP adapter', () => {
  it('constructs the semantic MCP server', () => {
    expect(createMcpServer()).toBeDefined();
  });

  it('dogfoods the semantic pipeline through the MCP protocol', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(client.listTools()).resolves.toMatchObject({ tools: expect.any(Array) });
      const inspected = parseToolResult(
        await client.callTool({ name: 'inspect_media', arguments: { input: fixture } }),
      );
      expect(inspected).toMatchObject({ kind: 'video', video: { aspectRatio: '16:9' } });

      const planned = parseToolResult(
        await client.callTool({
          name: 'plan_media',
          arguments: {
            input: fixture,
            goals: {
              durationSeconds: 1,
              aspectRatio: '9:16',
              width: 180,
              height: 320,
              compatibility: 'high',
            },
          },
        }),
      ) as { plan: Record<string, unknown> };
      const output = join(directory, 'vertical.mp4');
      const executed = parseToolResult(
        await client.callTool({
          name: 'execute_media_plan',
          arguments: { plan: planned.plan, output },
        }),
      );
      expect(executed).toMatchObject({ output, verification: { passed: true } });

      const verified = parseToolResult(
        await client.callTool({
          name: 'verify_media',
          arguments: { plan: planned.plan, output },
        }),
      );
      expect(verified).toMatchObject({ passed: true });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns structured tool errors', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const response = await client.callTool({
        name: 'execute_media_plan',
        arguments: { plan: '{not json', output: join(directory, 'invalid.mp4') },
      });
      expect(response.isError).toBe(true);
      expect(parseToolResult(response)).toMatchObject({ code: 'INVALID_PLAN' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('exposes the vertical workflow with protocol-native progress', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-progress-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const progress: number[] = [];

    try {
      const output = join(directory, 'mcp-workflow.mp4');
      const response = await client.callTool(
        {
          name: 'make_vertical',
          arguments: { input: fixture, output, width: 180, height: 320, durationSeconds: 1 },
        },
        undefined,
        {
          onprogress: (event) => progress.push(event.progress),
          resetTimeoutOnProgress: true,
        },
      );
      expect(parseToolResult(response)).toMatchObject({
        output: { path: output, video: { aspectRatio: '9:16' } },
        verification: { passed: true },
      });
      expect(progress[0]).toBe(0);
      expect(progress.at(-1)).toBe(100);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects unknown goal keys with a validation error', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const response = await client.callTool({
        name: 'plan_media',
        arguments: { input: fixture, goals: { bogus: true } },
      });
      expect(response.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects an empty goals object', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const response = await client.callTool({
        name: 'plan_media',
        arguments: { input: fixture, goals: {} },
      });
      expect(response.isError).toBe(true);
      expect(parseToolResult(response)).toMatchObject({ code: 'INVALID_PLAN' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('exposes the concatenate_media tool and produces a longer output', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-concat-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const output = join(directory, 'mcp-concat.mp4');
      const response = await client.callTool({
        name: 'concatenate_media',
        arguments: { input: fixture, inputs: [fixture], output, overwrite: true },
      });
      const result = parseToolResult(response) as {
        output: { durationSeconds?: number };
        verification: { passed: boolean };
      };
      expect(result.output.durationSeconds).toBeGreaterThan(3.5);
      expect(result.verification.passed).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('registers fifteen semantic tools', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBe(15);
      expect(tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'inspect_media',
          'get_media_capabilities',
          'plan_media',
          'validate_plan',
          'repair_plan',
          'get_media_plan_schema',
          'make_vertical',
          'optimize_for_web',
          'normalize_media',
          'extract_audio',
          'extract_frame',
          'concatenate_media',
          'execute_media_plan',
          'inspect_receipt',
          'verify_media',
        ]),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('sets readOnlyHint on read-only tools', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      const inspect = tools.find((t) => t.name === 'inspect_media');
      const vertical = tools.find((t) => t.name === 'make_vertical');
      expect(inspect?.annotations?.readOnlyHint).toBe(true);
      expect(vertical?.annotations?.destructiveHint).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('detects and repairs plan issues through the MCP protocol', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-repair-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      // A persisted plan that was valid when created but is now out of range
      // for this 2-second fixture — exactly what validate/repair exist for.
      const stalePlan = {
        irVersion: '1',
        source: { path: fixture },
        constraints: {},
        steps: [
          {
            id: 'trim-1',
            operation: 'trim',
            startSeconds: 0,
            endSeconds: 10,
            reason: 'The caller requested a shorter time range.',
          },
          {
            id: 'encode-1',
            operation: 'encode',
            profile: 'high-compatibility',
            reason: 'A broadly compatible output was requested.',
          },
        ],
        expectations: { durationSeconds: 10, videoCodec: 'h264', pixelFormat: 'yuv420p' },
      };

      const issues = parseToolResult(
        await client.callTool({
          name: 'validate_plan',
          arguments: { plan: stalePlan },
        }),
      ) as { issues: Array<{ field: string; repairable: boolean }> };
      expect(issues.issues.some((issue) => issue.field.includes('endSeconds'))).toBe(true);

      const repaired = parseToolResult(
        await client.callTool({
          name: 'repair_plan',
          arguments: { plan: stalePlan },
        }),
      ) as { repairs: Array<{ field: string }>; repairedPlan: Record<string, unknown> };
      expect(repaired.repairs.length).toBeGreaterThan(0);
      expect(repaired.repairedPlan).toBeDefined();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('executes with writeReceipt and inspects the receipt', async () => {
    const server = createMcpServer();
    const client = new Client({ name: 'agent-media-receipt-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const planned = parseToolResult(
        await client.callTool({
          name: 'plan_media',
          arguments: { input: fixture, goals: { compatibility: 'high', durationSeconds: 1 } },
        }),
      ) as { plan: Record<string, unknown> };

      const output = join(directory, 'mcp-receipt.mp4');
      const executed = parseToolResult(
        await client.callTool({
          name: 'execute_media_plan',
          arguments: { plan: planned.plan, output, writeReceipt: true },
        }),
      ) as { receipt: { receiptVersion: string; planFingerprint: string } };
      expect(executed.receipt.receiptVersion).toBe('1');

      const inspected = parseToolResult(
        await client.callTool({
          name: 'inspect_receipt',
          arguments: { receipt: JSON.stringify(executed.receipt) },
        }),
      ) as { receiptVersion: string };
      expect(inspected.receiptVersion).toBe('1');
    } finally {
      await client.close();
      await server.close();
    }
  });
});

function parseToolResult(response: unknown): unknown {
  if (typeof response !== 'object' || response === null || !('content' in response)) {
    throw new Error('Expected an immediate MCP tool result.');
  }
  const content = response.content;
  if (!Array.isArray(content) || content[0]?.type !== 'text') {
    throw new Error('Expected an MCP text result.');
  }
  return JSON.parse(String(content[0].text)) as unknown;
}
