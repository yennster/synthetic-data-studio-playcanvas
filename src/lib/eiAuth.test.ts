import { describe, expect, it } from 'vitest';
import { eiAuthSatisfied } from './eiAuth';

describe('eiAuthSatisfied', () => {
  it('is satisfied by a non-empty API key', () => {
    expect(eiAuthSatisfied('ei_abc123', false)).toBe(true);
  });

  it('rejects an empty or whitespace-only key without the bypass', () => {
    expect(eiAuthSatisfied('', false)).toBe(false);
    expect(eiAuthSatisfied('   ', false)).toBe(false);
  });

  it('bypassAuth satisfies the gate with no key at all', () => {
    expect(eiAuthSatisfied('', true)).toBe(true);
    expect(eiAuthSatisfied('   ', true)).toBe(true);
  });

  it('bypassAuth is harmless when a key is present', () => {
    expect(eiAuthSatisfied('ei_abc123', true)).toBe(true);
  });
});
