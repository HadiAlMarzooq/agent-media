import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/index.js';

describe('CLI', () => {
  it('defines the semantic command surface', () => {
    expect(createProgram().commands.map((command) => command.name())).toEqual([
      'inspect',
      'capabilities',
      'plan',
      'execute',
      'verify',
    ]);
  });
});
