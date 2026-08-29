import { describe, expect, it } from 'vitest';

import { planMedia, validatePlan } from '../src/index.js';

describe('workspace foundation', () => {
  it('exports the semantic planning API', () => {
    expect(planMedia).toBeTypeOf('function');
  });

  it('requires concatenation to begin with the declared source', () => {
    expect(() =>
      validatePlan({
        irVersion: '1',
        source: { path: '/media/first.mp4' },
        constraints: {},
        steps: [
          {
            id: 'join',
            operation: 'concatenate',
            inputs: ['/media/different.mp4', '/media/second.mp4'],
            reason: 'test',
          },
        ],
        expectations: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_PLAN' }));
  });
});
