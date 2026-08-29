import { describe, expect, it } from 'vitest';

import { createMcpServer } from '../src/index.js';

describe('MCP adapter', () => {
  it('constructs the semantic MCP server', () => {
    expect(createMcpServer()).toBeDefined();
  });
});
