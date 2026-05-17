import { describe, it, expect } from 'vitest';
import {
  formatSpeed,
  isPresetMatch,
  clampSpeed,
  isValidSpeed,
} from '../../../src/ui/popup/popup-helpers.js';

describe('popup-helpers / formatSpeed', () => {
  it('drops trailing zero for integer speeds', () => {
    expect(formatSpeed(1)).toBe('1');
    expect(formatSpeed(1.0)).toBe('1');
    expect(formatSpeed(2.0)).toBe('2');
  });

  it('keeps significant decimals', () => {
    expect(formatSpeed(1.5)).toBe('1.5');
    expect(formatSpeed(1.25)).toBe('1.25');
    expect(formatSpeed(0.75)).toBe('0.75');
  });

  it('rounds float-artifact values to 2 decimals', () => {
    expect(formatSpeed(0.1 + 0.1 + 0.1)).toBe('0.3');
    expect(formatSpeed(1.9999999)).toBe('2');
  });

  it('returns default "1" for invalid input', () => {
    expect(formatSpeed(null)).toBe('1');
    expect(formatSpeed(undefined)).toBe('1');
    expect(formatSpeed(NaN)).toBe('1');
    expect(formatSpeed('1.5')).toBe('1');
  });
});

describe('popup-helpers / isPresetMatch', () => {
  it('matches exact value', () => {
    expect(isPresetMatch(1.75, 1.75)).toBe(true);
    expect(isPresetMatch(1.0, 1.0)).toBe(true);
  });

  it('matches within float tolerance', () => {
    expect(isPresetMatch(0.1 + 0.1 + 0.1, 0.3)).toBe(true);
  });

  it('rejects mismatched values', () => {
    expect(isPresetMatch(1.5, 1.75)).toBe(false);
    expect(isPresetMatch(1.5, 2.0)).toBe(false);
  });

  it('rejects invalid inputs', () => {
    expect(isPresetMatch(null, 1.0)).toBe(false);
    expect(isPresetMatch(1.0, null)).toBe(false);
    expect(isPresetMatch(NaN, 1.0)).toBe(false);
  });
});

describe('popup-helpers / clampSpeed', () => {
  it('clamps to allowed range', () => {
    expect(clampSpeed(20)).toBe(16);
    expect(clampSpeed(0.01)).toBe(0.07);
    expect(clampSpeed(1.5)).toBe(1.5);
  });

  it('rounds to 2 decimals', () => {
    expect(clampSpeed(1.7777777)).toBe(1.78);
    expect(clampSpeed(0.1 + 0.1 + 0.1)).toBe(0.3);
  });

  it('returns min for invalid input', () => {
    expect(clampSpeed(NaN)).toBe(0.07);
    expect(clampSpeed(null)).toBe(0.07);
  });
});

describe('popup-helpers / isValidSpeed', () => {
  it('accepts finite numbers', () => {
    expect(isValidSpeed(1)).toBe(true);
    expect(isValidSpeed(0)).toBe(true);
    expect(isValidSpeed(-1)).toBe(true);
  });

  it('rejects non-finite or non-number', () => {
    expect(isValidSpeed(NaN)).toBe(false);
    expect(isValidSpeed(Infinity)).toBe(false);
    expect(isValidSpeed(null)).toBe(false);
    expect(isValidSpeed(undefined)).toBe(false);
    expect(isValidSpeed('1')).toBe(false);
  });
});
