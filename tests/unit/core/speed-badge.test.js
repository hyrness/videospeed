import { describe, it, expect, vi } from 'vitest';
import { formatSpeedBadge, createBadgeController } from '../../../src/core/speed-badge.js';

describe('formatSpeedBadge', () => {
  it('shows 1.0x as "1"', () => {
    expect(formatSpeedBadge(1.0)).toBe('1');
  });

  it('trims trailing zeros', () => {
    expect(formatSpeedBadge(1.5)).toBe('1.5');
    expect(formatSpeedBadge(2.0)).toBe('2');
  });

  it('keeps two significant decimals', () => {
    expect(formatSpeedBadge(1.75)).toBe('1.75');
    expect(formatSpeedBadge(0.07)).toBe('0.07');
  });

  it('formats the max speed', () => {
    expect(formatSpeedBadge(16)).toBe('16');
  });

  it('drops to one decimal for two-digit speeds so the badge stays ≤4 chars', () => {
    expect(formatSpeedBadge(12.5)).toBe('12.5');
    expect(formatSpeedBadge(10)).toBe('10');
    // Reachable two-decimal speeds must never exceed 4 chars.
    for (const speed of [10.25, 11.95, 12.75, 15.95, 16]) {
      expect(formatSpeedBadge(speed).length).toBeLessThanOrEqual(4);
    }
  });

  it('returns empty string for null / non-finite / non-number', () => {
    expect(formatSpeedBadge(null)).toBe('');
    expect(formatSpeedBadge(undefined)).toBe('');
    expect(formatSpeedBadge(NaN)).toBe('');
    expect(formatSpeedBadge(Infinity)).toBe('');
    expect(formatSpeedBadge('1.5')).toBe('');
  });
});

function makeChromeApi({ getSpeedResponse = { speed: 1.0 }, lastError = null } = {}) {
  return {
    runtime: { lastError },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    tabs: {
      sendMessage: vi.fn((tabId, message, callback) => callback(getSpeedResponse)),
    },
  };
}

describe('createBadgeController', () => {
  it('init sets a badge background color', () => {
    const api = makeChromeApi();
    const c = createBadgeController(api);
    c.init();
    expect(api.action.setBadgeBackgroundColor).toHaveBeenCalledTimes(1);
  });

  it('handleSpeedMessage sets the badge for the active tab when enabled', () => {
    const api = makeChromeApi();
    const c = createBadgeController(api);
    c.setEnabled(true);
    c.setActiveTab(5);
    api.action.setBadgeText.mockClear();
    c.handleSpeedMessage(1.5, 5);
    expect(api.action.setBadgeText).toHaveBeenCalledWith({ text: '1.5' });
  });

  it('handleSpeedMessage ignores non-active tabs', () => {
    const api = makeChromeApi();
    const c = createBadgeController(api);
    c.setEnabled(true);
    c.setActiveTab(5);
    api.action.setBadgeText.mockClear();
    c.handleSpeedMessage(2.0, 99);
    expect(api.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('handleSpeedMessage does nothing when disabled', () => {
    const api = makeChromeApi();
    const c = createBadgeController(api);
    c.setActiveTab(5);
    c.setEnabled(false);
    api.action.setBadgeText.mockClear();
    c.handleSpeedMessage(2.0, 5);
    expect(api.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('setEnabled(false) clears the badge', () => {
    const api = makeChromeApi();
    const c = createBadgeController(api);
    c.setEnabled(false);
    expect(api.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('setActiveTab refreshes the badge from the tab speed', () => {
    const api = makeChromeApi({ getSpeedResponse: { speed: 1.75 } });
    const c = createBadgeController(api);
    c.setEnabled(true);
    c.setActiveTab(7);
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { type: 'VSC_GET_SPEED' },
      expect.any(Function)
    );
    expect(api.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1.75' });
  });

  it('refresh clears the badge when the tab has no media (null speed)', () => {
    const api = makeChromeApi({ getSpeedResponse: { speed: null } });
    const c = createBadgeController(api);
    c.setEnabled(true);
    c.setActiveTab(7);
    expect(api.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('refresh clears the badge on lastError (no content script)', () => {
    const api = makeChromeApi({
      getSpeedResponse: undefined,
      lastError: { message: 'no receiver' },
    });
    const c = createBadgeController(api);
    c.setEnabled(true);
    c.setActiveTab(7);
    expect(api.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });
});
