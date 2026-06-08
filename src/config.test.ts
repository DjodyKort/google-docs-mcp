import { describe, expect, it } from 'vitest';
import { parseStatelessFlag } from './config.js';

describe('parseStatelessFlag', () => {
  it('defaults to false when no value is provided', () => {
    expect(parseStatelessFlag(undefined)).toBe(false);
    expect(parseStatelessFlag('')).toBe(false);
    expect(parseStatelessFlag('  ')).toBe(false);
  });

  it('returns true for "true" (case-insensitive)', () => {
    expect(parseStatelessFlag('true')).toBe(true);
    expect(parseStatelessFlag('TRUE')).toBe(true);
    expect(parseStatelessFlag('True')).toBe(true);
    expect(parseStatelessFlag(' true ')).toBe(true);
  });

  it('returns true for "1"', () => {
    expect(parseStatelessFlag('1')).toBe(true);
  });

  it('returns false for other values', () => {
    expect(parseStatelessFlag('false')).toBe(false);
    expect(parseStatelessFlag('0')).toBe(false);
    expect(parseStatelessFlag('yes')).toBe(false);
    expect(parseStatelessFlag('stateless')).toBe(false);
  });
});
