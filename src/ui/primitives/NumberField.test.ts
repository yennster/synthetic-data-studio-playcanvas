import { describe, expect, it } from 'vitest';
import { clampNumber, decideOnBlur, decideOnChange } from './NumberField';

describe('clampNumber', () => {
  it('passes values through without opts', () => {
    expect(clampNumber(42)).toBe(42);
    expect(clampNumber(-3.5, {})).toBe(-3.5);
  });

  it('clamps to min and max', () => {
    expect(clampNumber(0, { min: 1, max: 500 })).toBe(1);
    expect(clampNumber(9999, { min: 1, max: 500 })).toBe(500);
    expect(clampNumber(250, { min: 1, max: 500 })).toBe(250);
  });

  it('handles one-sided bounds', () => {
    expect(clampNumber(-10, { min: 0 })).toBe(0);
    expect(clampNumber(10, { max: 5 })).toBe(5);
  });
});

describe('decideOnChange', () => {
  it('preserves an empty draft without committing', () => {
    expect(decideOnChange('', 10)).toEqual({ draft: '', commit: null });
  });

  it('preserves a lone minus without committing', () => {
    expect(decideOnChange('-', 10)).toEqual({ draft: '-', commit: null });
  });

  it('preserves an unparseable draft without committing', () => {
    expect(decideOnChange('1e', 10)).toEqual({ draft: '1e', commit: null });
  });

  it('commits a finite number that differs from upstream', () => {
    expect(decideOnChange('12', 10)).toEqual({ draft: '12', commit: 12 });
  });

  it('does not re-commit the current upstream value', () => {
    expect(decideOnChange('10', 10)).toEqual({ draft: '10', commit: null });
  });

  it('commits out-of-range values at the boundary, keeping the raw draft', () => {
    expect(decideOnChange('9999', 10, { min: 1, max: 500 })).toEqual({
      draft: '9999',
      commit: 500,
    });
  });

  it('skips the commit when the clamped value equals upstream', () => {
    // Typing "700" then "7000" with max 500: both clamp to 500 — the
    // second keystroke must not re-fire onCommit.
    expect(decideOnChange('7000', 500, { max: 500 })).toEqual({
      draft: '7000',
      commit: null,
    });
  });
});

describe('decideOnBlur', () => {
  it('snaps an empty draft back to the committed value', () => {
    expect(decideOnBlur('', 10)).toEqual({ draft: '10', commit: null });
  });

  it('snaps a lone minus back to the committed value', () => {
    expect(decideOnBlur('-', 10)).toEqual({ draft: '10', commit: null });
  });

  it('snaps an unparseable draft back to the committed value', () => {
    expect(decideOnBlur('abc', 10)).toEqual({ draft: '10', commit: null });
  });

  it('keeps and commits an in-range draft', () => {
    expect(decideOnBlur('42', 10, { min: 1, max: 500 })).toEqual({
      draft: '42',
      commit: 42,
    });
  });

  it('rewrites an out-of-range draft to the clamped value and commits it', () => {
    expect(decideOnBlur('9999', 10, { min: 1, max: 500 })).toEqual({
      draft: '500',
      commit: 500,
    });
  });

  it('does not commit when the draft equals the upstream value', () => {
    expect(decideOnBlur('10', 10)).toEqual({ draft: '10', commit: null });
  });

  it('rewrites without committing when the clamp lands on the upstream value', () => {
    expect(decideOnBlur('0', 1, { min: 1 })).toEqual({
      draft: '1',
      commit: null,
    });
  });
});
