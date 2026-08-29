import { describe, expect, it } from 'vitest';

import { planMedia } from '../src/index.js';

describe('workspace foundation', () => {
  it('exports the semantic planning API', () => {
    expect(planMedia).toBeTypeOf('function');
  });
});
