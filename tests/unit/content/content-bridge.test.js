/**
 * Tests for content-bridge.js (ISOLATED world bridge).
 *
 * Focused on behavioral contracts, not implementation details:
 *   - Trust boundary: only lastSpeed writable from MAIN world
 *   - Blacklist correctness: domain-boundary matching, invalid regex handling
 *   - Settings handshake: request/response protocol
 *   - Lifecycle: teardown/reinit dispatch on storage changes
 *   - Early exit: disabled/blacklisted sites skip initialization
 *
 * The bridge auto-inits at module load. Each test uses vi.resetModules() +
 * dynamic import for fresh state. Chrome mock must be configured BEFORE import.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  installChromeMock,
  cleanupChromeMock,
  resetMockStorage,
  getMockStorage,
} from '../../helpers/chrome-mock.js';

const docEl = document.documentElement;

// --- Minimal test infrastructure ---

/** MV3 bridge uses `await chrome.storage.sync.get(null)` — wrap callback mock. */
function promisifyChromeMock() {
  const origGet = globalThis.chrome.storage.sync.get;
  globalThis.chrome.storage.sync.get = (keys, callback) => {
    if (typeof callback === 'function') {
      return origGet(keys, callback);
    }
    return new Promise((resolve) => origGet(keys, resolve));
  };
  const origSet = globalThis.chrome.storage.sync.set;
  globalThis.chrome.storage.sync.set = (items, callback) => {
    if (typeof callback === 'function') {
      return origSet(items, callback);
    }
    return new Promise((resolve) => origSet(items, resolve));
  };
}

/** Track docEl listeners so afterEach can clean up bridge-registered ones. */
function interceptDocEl() {
  const registered = [];
  const origAdd = docEl.addEventListener.bind(docEl);
  const origRemove = docEl.removeEventListener.bind(docEl);
  docEl.addEventListener = (type, handler, options) => {
    registered.push({ type, handler, options });
    return origAdd(type, handler, options);
  };
  docEl.removeEventListener = (type, handler, options) => {
    const idx = registered.findIndex((r) => r.type === type && r.handler === handler);
    if (idx !== -1) {
      registered.splice(idx, 1);
    }
    return origRemove(type, handler, options);
  };
  return () => {
    for (const { type, handler, options } of registered) {
      origRemove(type, handler, options);
    }
    registered.length = 0;
    docEl.addEventListener = origAdd;
    docEl.removeEventListener = origRemove;
  };
}

/** Load bridge, capture its onChanged listener, return it for direct invocation. */
async function loadBridge() {
  const captured = [];
  const origAddListener = globalThis.chrome.storage.onChanged.addListener;
  globalThis.chrome.storage.onChanged.addListener = (cb) => {
    captured.push(cb);
    origAddListener(cb);
  };
  vi.resetModules();
  await import('../../../src/entries/content-bridge.js');
  await vi.advanceTimersByTimeAsync(50);
  await vi.advanceTimersByTimeAsync(10);
  globalThis.chrome.storage.onChanged.addListener = origAddListener;
  return captured[0] || null;
}

/** Load bridge and additionally capture its chrome.runtime.onMessage listener. */
async function loadBridgeWithMessageCapture() {
  const onChangedListeners = [];
  const onMessageListeners = [];

  const origStorageAdd = globalThis.chrome.storage.onChanged.addListener;
  globalThis.chrome.storage.onChanged.addListener = (cb) => {
    onChangedListeners.push(cb);
    origStorageAdd(cb);
  };

  const origMsgAdd = globalThis.chrome.runtime.onMessage.addListener;
  globalThis.chrome.runtime.onMessage.addListener = (cb) => {
    onMessageListeners.push(cb);
  };

  vi.resetModules();
  await import('../../../src/entries/content-bridge.js');
  await vi.advanceTimersByTimeAsync(50);
  await vi.advanceTimersByTimeAsync(10);

  globalThis.chrome.storage.onChanged.addListener = origStorageAdd;
  globalThis.chrome.runtime.onMessage.addListener = origMsgAdd;

  return {
    onChanged: onChangedListeners[0] || null,
    onMessage: onMessageListeners[0] || null,
  };
}

/** Collect CustomEvents on docEl. Returns { events, cleanup }. */
function collectEvents(...names) {
  const events = [];
  const handlers = names.map((name) => {
    const h = (e) => events.push({ type: name, detail: e.detail });
    docEl.addEventListener(name, h);
    return { name, handler: h };
  });
  return {
    events,
    cleanup: () =>
      handlers.forEach(({ name, handler }) => docEl.removeEventListener(name, handler)),
  };
}

// --- Tests ---

describe('content-bridge', () => {
  let cleanupIntercept = null;
  let eventCleanup = null;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installChromeMock();
    resetMockStorage();
    promisifyChromeMock();
    cleanupIntercept = interceptDocEl();
  });

  afterEach(() => {
    if (eventCleanup) {
      eventCleanup();
      eventCleanup = null;
    }
    if (cleanupIntercept) {
      cleanupIntercept();
      cleanupIntercept = null;
    }
    vi.unstubAllGlobals();
    vi.useRealTimers();
    cleanupChromeMock();
  });

  // =========================================================================
  // Early exit — disabled/blacklisted sites skip initialization
  // =========================================================================

  describe('early exit', () => {
    it('signals abort when extension is disabled', async () => {
      getMockStorage().enabled = false;
      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();

      // Bridge responds with abort signal so inject.js knows not to init
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBe(true);
    });

    it('signals abort when URL matches blacklist', async () => {
      // jsdom default URL is http://localhost/
      getMockStorage().blacklist = 'localhost';

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBe(true);
    });

    it('blacklist is ignored when siteRules exists (post-migration)', async () => {
      // Regression: the settings migration preserves the legacy blacklist string
      // in storage for sync compat but siteRules is the source of truth post-migration.
      // A site removed from siteRules must not remain blocked by the stale blacklist.
      getMockStorage().blacklist = 'localhost'; // matches jsdom URL
      getMockStorage().siteRules = []; // migration ran, no disable rule for localhost

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBeUndefined(); // NOT aborted
    });

    it('blacklist uses domain boundary matching (x.com does NOT match localhost)', async () => {
      // Regression test for fixed bug: raw RegExp('x.com') would match
      // any URL containing 'x.com'. isBlacklisted() uses domain boundaries.
      getMockStorage().blacklist = 'x.com';
      // jsdom URL http://localhost/ does NOT match x.com → bridge should init

      const onChanged = await loadBridge();
      expect(onChanged).not.toBeNull();
    });

    it('signals abort when siteRule disables current URL', async () => {
      // Match jsdom's default location (http://localhost/)
      getMockStorage().siteRules = [{ pattern: 'localhost', enabled: false }];

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      await loadBridge();
      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      expect(events).toHaveLength(1);
      expect(events[0].detail.abort).toBe(true);
    });
  });

  // =========================================================================
  // Settings handshake — request/response protocol
  // =========================================================================

  describe('settings handshake', () => {
    it('responds to VSC_REQUEST_SETTINGS with settings payload', async () => {
      getMockStorage().lastSpeed = 2.5;
      getMockStorage().rememberSpeed = true;
      await loadBridge();

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));
      expect(events).toHaveLength(1);
      expect(events[0].detail.settings.lastSpeed).toBe(2.5);
      expect(events[0].detail.settings.rememberSpeed).toBe(true);
    });

    it('strips sensitive keys, passes customCSS, includes hostname', async () => {
      getMockStorage().blacklist = 'some.site';
      getMockStorage().enabled = true;
      getMockStorage().customCSS = 'vsc-controller { top: 42px; }';
      await loadBridge();

      const { events, cleanup } = collectEvents('VSC_SETTINGS_READY');
      eventCleanup = cleanup;

      docEl.dispatchEvent(new CustomEvent('VSC_REQUEST_SETTINGS'));

      const { settings, hostname } = events[0].detail;
      // Stripped from settings
      expect(settings.blacklist).toBeUndefined();
      expect(settings.enabled).toBeUndefined();
      // customCSS passes through (inject.js reads it from config.settings)
      expect(settings.customCSS).toBe('vsc-controller { top: 42px; }');
      expect(typeof hostname).toBe('string');
    });
  });

  // =========================================================================
  // Trust boundary — only lastSpeed writable from MAIN world
  // =========================================================================

  describe('VSC_WRITE_STORAGE trust boundary', () => {
    it('writes valid lastSpeed to chrome.storage and clamps to range', async () => {
      await loadBridge();
      const storage = getMockStorage();

      // Valid speed
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 2.5 } }));
      await vi.advanceTimersByTimeAsync(20);
      expect(storage.lastSpeed).toBe(2.5);

      // Clamped to min (0.07)
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 0.01 } }));
      await vi.advanceTimersByTimeAsync(20);
      expect(storage.lastSpeed).toBe(0.07);

      // Clamped to max (16)
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 99 } }));
      await vi.advanceTimersByTimeAsync(20);
      expect(storage.lastSpeed).toBe(16);
    });

    it('rejects invalid speed values and non-speed keys', async () => {
      await loadBridge();
      const storage = getMockStorage();
      const originalSpeed = storage.lastSpeed;

      // Non-number
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: 'fast' } }));
      await vi.advanceTimersByTimeAsync(20);
      expect(storage.lastSpeed).toBe(originalSpeed);

      // NaN
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { lastSpeed: NaN } }));
      await vi.advanceTimersByTimeAsync(20);
      expect(storage.lastSpeed).toBe(originalSpeed);

      // Non-lastSpeed key (trust boundary)
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: { startHidden: true } }));
      await vi.advanceTimersByTimeAsync(20);
      expect(storage.startHidden).toBe(false); // unchanged from default

      // Null detail
      docEl.dispatchEvent(new CustomEvent('VSC_WRITE_STORAGE', { detail: null }));
      await vi.advanceTimersByTimeAsync(20);
      expect(storage.lastSpeed).toBe(originalSpeed);
    });
  });

  // =========================================================================
  // Lifecycle — teardown/reinit on storage changes
  // =========================================================================

  describe('lifecycle', () => {
    // Lifecycle (teardown/reinit) is scoped to the popup's `enabled` toggle
    // only. siteRules/blacklist changes take effect on next page load — they
    // do NOT trigger live lifecycle events. This prevents every options save
    // from reinitializing every active tab. (#1505)

    it('dispatches VSC_TEARDOWN when disabled via popup toggle', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged({ enabled: { oldValue: true, newValue: false } }, 'sync');
      const teardowns = events.filter((e) => e.detail?.type === 'VSC_TEARDOWN');
      expect(teardowns).toHaveLength(1);
    });

    it('dispatches VSC_REINIT when re-enabled via popup toggle', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged({ enabled: { oldValue: false, newValue: true } }, 'sync');
      const reinits = events.filter((e) => e.detail?.type === 'VSC_REINIT');
      expect(reinits).toHaveLength(1);
    });

    it('does NOT lifecycle on blacklist changes (takes effect on reload)', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged({ blacklist: { oldValue: '', newValue: 'localhost' } }, 'sync');
      const lifecycle = events.filter(
        (e) => e.detail?.type === 'VSC_TEARDOWN' || e.detail?.type === 'VSC_REINIT'
      );
      expect(lifecycle).toHaveLength(0);
    });

    it('does NOT lifecycle on siteRules changes (takes effect on reload)', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged(
        { siteRules: { oldValue: [], newValue: [{ pattern: 'localhost', enabled: false }] } },
        'sync'
      );
      const lifecycle = events.filter(
        (e) => e.detail?.type === 'VSC_TEARDOWN' || e.detail?.type === 'VSC_REINIT'
      );
      expect(lifecycle).toHaveLength(0);
    });

    it('does NOT dispatch teardown/reinit on unrelated storage changes', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onChanged({ lastSpeed: { oldValue: 1.0, newValue: 2.0 } }, 'sync');

      const lifecycle = events.filter(
        (e) => e.detail?.type === 'VSC_TEARDOWN' || e.detail?.type === 'VSC_REINIT'
      );
      expect(lifecycle).toHaveLength(0);
    });

    it('ignores non-sync namespace changes', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_MESSAGE', 'VSC_STORAGE_CHANGED');
      eventCleanup = cleanup;

      onChanged({ enabled: { oldValue: true, newValue: false } }, 'local');
      expect(events).toHaveLength(0);
    });
  });

  // =========================================================================
  // Storage relay — changes forwarded to MAIN world with filtering
  // =========================================================================

  describe('storage relay', () => {
    it('relays storage changes to MAIN world, filtering out sensitive keys', async () => {
      const onChanged = await loadBridge();
      const { events, cleanup } = collectEvents('VSC_STORAGE_CHANGED');
      eventCleanup = cleanup;

      // Mixed change: lastSpeed (should relay) + enabled (should filter)
      onChanged(
        {
          lastSpeed: { oldValue: 1.0, newValue: 2.0 },
          enabled: { oldValue: true, newValue: true },
          blacklist: { oldValue: '', newValue: '' },
        },
        'sync'
      );

      expect(events).toHaveLength(1);
      expect(events[0].detail.lastSpeed).toBeDefined();
      expect(events[0].detail.enabled).toBeUndefined();
      expect(events[0].detail.blacklist).toBeUndefined();
    });
  });

  // Runtime message relay: chrome mock doesn't expose onMessage listeners,
  // so we can't unit-test the relay without enhancing the mock. The relay is
  // a trivial one-liner (line 119 of content-bridge.js) — tested via manual
  // popup interaction rather than unit tests.

  // =========================================================================
  // VSC_GET_SPEED — popup queries live playback rate for display
  // =========================================================================
  // Popup opens after a keyboard speed change need to show the actual current
  // speed, not whatever was last persisted via the scope tabs. The bridge runs
  // in the ISOLATED world but shares the DOM with the page, so it can read
  // video.playbackRate directly without round-tripping through inject.js.

  describe('VSC_GET_SPEED', () => {
    afterEach(() => {
      // Clean up any video/audio elements left in the document.
      document.querySelectorAll('video, audio').forEach((el) => el.remove());
    });

    it('returns playbackRate from the only video on the page', async () => {
      const video = document.createElement('video');
      video.playbackRate = 1.3;
      document.body.appendChild(video);

      const { onMessage } = await loadBridgeWithMessageCapture();
      expect(onMessage).not.toBeNull();

      const responses = [];
      onMessage({ type: 'VSC_GET_SPEED' }, {}, (r) => responses.push(r));

      expect(responses).toHaveLength(1);
      expect(responses[0]).toEqual({ speed: 1.3 });
    });

    it('prefers a playing video over a paused one', async () => {
      const paused = document.createElement('video');
      paused.playbackRate = 0.75;
      Object.defineProperty(paused, 'paused', { value: true, configurable: true });

      const playing = document.createElement('video');
      playing.playbackRate = 1.5;
      Object.defineProperty(playing, 'paused', { value: false, configurable: true });

      document.body.appendChild(paused);
      document.body.appendChild(playing);

      const { onMessage } = await loadBridgeWithMessageCapture();

      const responses = [];
      onMessage({ type: 'VSC_GET_SPEED' }, {}, (r) => responses.push(r));

      expect(responses[0]).toEqual({ speed: 1.5 });
    });

    it('returns null when the page has no media', async () => {
      const { onMessage } = await loadBridgeWithMessageCapture();

      const responses = [];
      onMessage({ type: 'VSC_GET_SPEED' }, {}, (r) => responses.push(r));

      expect(responses[0]).toEqual({ speed: null });
    });

    it('does not relay VSC_GET_SPEED to MAIN world (read-only handled in bridge)', async () => {
      const video = document.createElement('video');
      video.playbackRate = 1.0;
      document.body.appendChild(video);

      const { onMessage } = await loadBridgeWithMessageCapture();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onMessage({ type: 'VSC_GET_SPEED' }, {}, () => {});

      const relayed = events.filter((e) => e.detail?.type === 'VSC_GET_SPEED');
      expect(relayed).toHaveLength(0);
    });

    it('relays unrelated message types to MAIN world (existing behavior intact)', async () => {
      const { onMessage } = await loadBridgeWithMessageCapture();
      const { events, cleanup } = collectEvents('VSC_MESSAGE');
      eventCleanup = cleanup;

      onMessage({ type: 'VSC_SET_SPEED', payload: { speed: 2.0 } }, {}, () => {});

      const relayed = events.filter((e) => e.detail?.type === 'VSC_SET_SPEED');
      expect(relayed).toHaveLength(1);
      expect(relayed[0].detail.payload).toEqual({ speed: 2.0 });
    });
  });

  describe('speed badge relay', () => {
    it('relays playbackRate to the background on ratechange for media elements', async () => {
      globalThis.chrome.runtime.sendMessage = vi.fn();
      await loadBridge();

      const video = document.createElement('video');
      document.body.appendChild(video);
      video.playbackRate = 1.5;
      const expected = video.playbackRate; // jsdom may clamp; assert against actual

      video.dispatchEvent(new Event('ratechange', { bubbles: true }));

      expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'VSC_SPEED',
        speed: expected,
      });

      video.remove();
    });

    it('ignores ratechange events from non-media targets', async () => {
      globalThis.chrome.runtime.sendMessage = vi.fn();
      await loadBridge();

      const div = document.createElement('div');
      document.body.appendChild(div);
      div.dispatchEvent(new Event('ratechange', { bubbles: true }));

      expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled();

      div.remove();
    });
  });
});
