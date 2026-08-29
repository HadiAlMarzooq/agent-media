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
