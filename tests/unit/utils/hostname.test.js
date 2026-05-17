import { describe, it, expect } from 'vitest';
import { normalizeHostname, getDomainSpeed } from '../../../src/utils/hostname.js';

describe('normalizeHostname', () => {
  it('strips leading www. for http(s)', () => {
    expect(normalizeHostname('https://www.youtube.com/watch?v=x')).toBe('youtube.com');
    expect(normalizeHostname('http://www.example.com/')).toBe('example.com');
  });

  it('returns bare hostname when no www', () => {
    expect(normalizeHostname('https://example.com/')).toBe('example.com');
    expect(normalizeHostname('https://sub.example.com/')).toBe('sub.example.com');
  });

  it('does not strip www inside a subdomain', () => {
    expect(normalizeHostname('https://www.www.example.com/')).toBe('www.example.com');
  });

  it('rejects file:// (no host portion)', () => {
    expect(normalizeHostname('file:///Users/me/video.mp4')).toBe(null);
  });

  it('rejects non-http(s) protocols', () => {
    expect(normalizeHostname('chrome://extensions')).toBe(null);
    expect(normalizeHostname('about:blank')).toBe(null);
    expect(normalizeHostname('chrome-extension://abc/popup.html')).toBe(null);
  });

  it('returns null for invalid input', () => {
    expect(normalizeHostname('')).toBe(null);
    expect(normalizeHostname(null)).toBe(null);
    expect(normalizeHostname(undefined)).toBe(null);
    expect(normalizeHostname('not a url')).toBe(null);
  });
});

describe('getDomainSpeed', () => {
  it('returns the stored override', () => {
    expect(getDomainSpeed({ 'youtube.com': 1.5 }, 'youtube.com')).toBe(1.5);
  });

  it('returns null when hostname is unset', () => {
    expect(getDomainSpeed({ 'youtube.com': 1.5 }, 'twitch.tv')).toBe(null);
  });

  it('rejects non-finite values', () => {
    expect(getDomainSpeed({ 'a.com': NaN }, 'a.com')).toBe(null);
    expect(getDomainSpeed({ 'a.com': null }, 'a.com')).toBe(null);
    expect(getDomainSpeed({ 'a.com': '1.5' }, 'a.com')).toBe(null);
  });

  it('returns null for missing inputs', () => {
    expect(getDomainSpeed(null, 'x.com')).toBe(null);
    expect(getDomainSpeed({}, null)).toBe(null);
    expect(getDomainSpeed(undefined, undefined)).toBe(null);
  });
});
