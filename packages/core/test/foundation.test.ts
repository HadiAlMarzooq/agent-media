import { describe, expect, it } from 'vitest';

import { CORE_VERSION } from '../src/index.js';

describe('workspace foundation', () => {
  it('exports a core package version', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });
});
