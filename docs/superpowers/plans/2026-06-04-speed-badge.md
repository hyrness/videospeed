# Speed Badge on Toolbar Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the active tab's current playback speed as a text badge on the extension toolbar icon.

**Architecture:** A new `src/core/speed-badge.js` module holds a pure `formatSpeedBadge()` formatter and a `createBadgeController(chromeApi)` factory that owns the active-tab/enabled state and drives `chrome.action.setBadgeText`. `content-bridge.js` (ISOLATED world) captures `ratechange` events on the shared DOM and relays the new `playbackRate` to the background via `chrome.runtime.sendMessage({type:'VSC_SPEED'})`. `background.js` wires Chrome events (messages, tab activation, window focus, storage changes) to the controller.

**Tech Stack:** Manifest V3 service worker, esbuild bundling (`scripts/build.mjs`), Vitest + jsdom unit tests, existing `tests/helpers/chrome-mock.js`.

Reference spec: `docs/superpowers/specs/2026-06-04-speed-badge-design.md`

---

### Task 1: `formatSpeedBadge` pure formatter

**Files:**

- Create: `src/core/speed-badge.js`
- Test: `tests/unit/core/speed-badge.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/speed-badge.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { formatSpeedBadge } from '../../../src/core/speed-badge.js';

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

  it('returns empty string for null / non-finite / non-number', () => {
    expect(formatSpeedBadge(null)).toBe('');
    expect(formatSpeedBadge(undefined)).toBe('');
    expect(formatSpeedBadge(NaN)).toBe('');
    expect(formatSpeedBadge(Infinity)).toBe('');
    expect(formatSpeedBadge('1.5')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core/speed-badge.test.js`
Expected: FAIL — cannot resolve `src/core/speed-badge.js` / `formatSpeedBadge is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/speed-badge.js`:

```javascript
/**
 * Speed badge helpers for the toolbar action icon.
 *
 * formatSpeedBadge: pure number → ≤4-char badge string.
 * createBadgeController: state holder wiring the active tab's speed to
 *   chrome.action.setBadgeText (added in Task 2).
 */

/**
 * Format a playback rate for the toolbar badge.
 * Trims trailing zeros so 1.00→"1", 1.50→"1.5", 1.75→"1.75", 0.07→"0.07".
 * Invalid / null / non-finite input clears the badge ("").
 *
 * @param {number} speed
 * @returns {string}
 */
export function formatSpeedBadge(speed) {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) {
    return '';
  }
  return speed.toFixed(2).replace(/\.?0+$/, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/core/speed-badge.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/speed-badge.js tests/unit/core/speed-badge.test.js
git commit -m "feat(badge): add formatSpeedBadge formatter"
```

---

### Task 2: `createBadgeController` state + badge logic

**Files:**

- Modify: `src/core/speed-badge.js`
- Test: `tests/unit/core/speed-badge.test.js` (extend)

The controller takes a `chromeApi` object so tests inject a fake — no global
chrome mock or module side effects involved.

Controller contract:

- `init()` — set the badge background color once.
- `setEnabled(bool)` — track enabled; when false, clear badge; when true, refresh from active tab.
- `setActiveTab(tabId)` — update the cached active tab, then refresh.
- `handleSpeedMessage(speed, senderTabId)` — set badge only if enabled AND `senderTabId === activeTabId`.
- `refreshFromActiveTab()` — ask the active tab for its speed via `VSC_GET_SPEED`; clear badge on no active tab / lastError / no response / null speed.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/core/speed-badge.test.js`:

```javascript
import { vi } from 'vitest';
import { createBadgeController } from '../../../src/core/speed-badge.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/core/speed-badge.test.js`
Expected: FAIL — `createBadgeController is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/core/speed-badge.js`:

```javascript
/**
 * Create the toolbar badge controller.
 *
 * Owns the cached active tab id and enabled flag, and is the single writer of
 * chrome.action.setBadgeText. The badge shows a single global value that always
 * reflects the active tab's current speed.
 *
 * @param {{
 *   runtime: { lastError: unknown },
 *   action: { setBadgeText: Function, setBadgeBackgroundColor: Function },
 *   tabs: { sendMessage: Function },
 * }} chromeApi
 */
export function createBadgeController(chromeApi) {
  let activeTabId = null;
  let enabled = true;

  const applyBadge = (text) => {
    chromeApi.action.setBadgeText({ text });
  };

  const refreshFromActiveTab = () => {
    if (!enabled || activeTabId == null) {
      applyBadge('');
      return;
    }
    chromeApi.tabs.sendMessage(activeTabId, { type: 'VSC_GET_SPEED' }, (response) => {
      if (chromeApi.runtime.lastError || !response) {
        applyBadge('');
        return;
      }
      applyBadge(formatSpeedBadge(response.speed));
    });
  };

  return {
    init() {
      chromeApi.action.setBadgeBackgroundColor({ color: '#0A84FF' });
    },
    setEnabled(value) {
      enabled = value !== false;
      if (!enabled) {
        applyBadge('');
      } else {
        refreshFromActiveTab();
      }
    },
    setActiveTab(tabId) {
      activeTabId = tabId;
      refreshFromActiveTab();
    },
    handleSpeedMessage(speed, senderTabId) {
      if (!enabled || senderTabId == null || senderTabId !== activeTabId) {
        return;
      }
      applyBadge(formatSpeedBadge(speed));
    },
    refreshFromActiveTab,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/core/speed-badge.test.js`
Expected: PASS (formatter + controller cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/speed-badge.js tests/unit/core/speed-badge.test.js
git commit -m "feat(badge): add badge controller state machine"
```

---

### Task 3: Extend chrome mock for badge + sendMessage

**Files:**

- Modify: `tests/helpers/chrome-mock.js`

The content-bridge relay test (Task 4) needs `chrome.runtime.sendMessage`, which
the mock lacks. Also add the `action` badge methods for completeness.

- [ ] **Step 1: Add `runtime.sendMessage` to the mock**

In `tests/helpers/chrome-mock.js`, inside the `runtime:` object (currently ending
after the `onMessage` block), add a `sendMessage` field. Find:

```javascript
    onMessage: {
      addListener: (_callback) => {
        // Mock message listener
      },
    },
  },
```

Replace with:

```javascript
    onMessage: {
      addListener: (_callback) => {
        // Mock message listener
      },
    },
    sendMessage: (_message, callback) => {
      setTimeout(() => callback && callback({}), 10);
    },
  },
```

- [ ] **Step 2: Add badge methods to `action`**

Find:

```javascript
  action: {
    setIcon: (details, callback) => {
      setTimeout(() => callback && callback(), 10);
    },
  },
```

Replace with:

```javascript
  action: {
    setIcon: (details, callback) => {
      setTimeout(() => callback && callback(), 10);
    },
    setBadgeText: (details, callback) => {
      setTimeout(() => callback && callback(), 10);
    },
    setBadgeBackgroundColor: (details, callback) => {
      setTimeout(() => callback && callback(), 10);
    },
  },
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `npx vitest run tests/unit/content/content-bridge.test.js`
Expected: PASS (no behavioral change; new fields are additive).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/chrome-mock.js
git commit -m "test: add sendMessage and badge methods to chrome mock"
```

---

### Task 4: content-bridge `ratechange` relay

**Files:**

- Modify: `src/entries/content-bridge.js`
- Test: `tests/unit/content/content-bridge.test.js` (add a describe block)

The relay listens for `ratechange` on `docEl` (capture phase). Events bubble
video → … → documentElement, so docEl catches both VSC-synthetic and native
rate changes. Registering on `docEl` (not `document`) lets the test's existing
`interceptDocEl` cleanup remove it between tests.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/content/content-bridge.test.js` (inside the top-level
`describe('content-bridge', ...)`, after the existing tests so it shares
`beforeEach`/`afterEach`). It reuses the `loadBridge` helper already defined in
the file:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/content/content-bridge.test.js`
Expected: FAIL — `sendMessage` not called (relay not implemented yet).

- [ ] **Step 3: Implement the relay**

In `src/entries/content-bridge.js`, locate the `handleWriteStorage` listener
registration near the end of `init()`:

```javascript
    docEl.addEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
  } catch (error) {
    console.error('[VSC] Bridge init failed:', error);
  }
}
```

Insert the relay handler immediately before that `docEl.addEventListener('VSC_WRITE_STORAGE', ...)` line:

```javascript
// --- Ongoing: speed badge relay ---
// Every rate change (VSC-synthetic or native) bubbles to docEl. We read the
// playbackRate off the shared DOM node and forward it to the background,
// which decides whether this tab is active and updates the toolbar badge.
const handleRateChange = (e) => {
  const target = e.target;
  if (!(target instanceof HTMLMediaElement)) {
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: 'VSC_SPEED', speed: target.playbackRate });
  } catch (err) {
    if (err.message?.includes('Extension context invalidated')) {
      docEl.removeEventListener('ratechange', handleRateChange, true);
    }
  }
};
docEl.addEventListener('ratechange', handleRateChange, true);

docEl.addEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/content/content-bridge.test.js`
Expected: PASS (both new cases + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/entries/content-bridge.js tests/unit/content/content-bridge.test.js
git commit -m "feat(badge): relay ratechange to background from content bridge"
```

---

### Task 5: Wire the controller into the background service worker

**Files:**

- Modify: `src/background.js`

No new unit test — this task is event-listener wiring around the
already-tested controller. Verification is the build + full test suite + a
manual load.

- [ ] **Step 1: Import the controller and instantiate it**

At the top of `src/background.js`, the existing `import { ... } from './utils/key-maps.js';`
block sits below the icon functions. Add a new import near it (top of file is
fine since esbuild bundles ESM). Add after the `key-maps.js` import block:

```javascript
import { createBadgeController } from './core/speed-badge.js';

const badge = createBadgeController(chrome);
badge.init();
```

- [ ] **Step 2: Track enabled state and active tab on init**

Replace the existing `initializeIcon` function:

```javascript
async function initializeIcon() {
  try {
    const storage = await chrome.storage.sync.get({ enabled: true });
    await updateIcon(storage.enabled);
  } catch (error) {
    console.error('Failed to initialize icon:', error);
    // Default to enabled if storage read fails
    await updateIcon(true);
  }
}
```

with:

```javascript
async function initializeIcon() {
  try {
    const storage = await chrome.storage.sync.get({ enabled: true });
    await updateIcon(storage.enabled);
    badge.setEnabled(storage.enabled !== false);
  } catch (error) {
    console.error('Failed to initialize icon:', error);
    // Default to enabled if storage read fails
    await updateIcon(true);
    badge.setEnabled(true);
  }
  syncActiveTab();
}

/**
 * Find the active tab in the focused window and hand it to the badge
 * controller, which refreshes the badge from that tab's current speed.
 */
function syncActiveTab() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || !tabs[0]) {
      return;
    }
    badge.setActiveTab(tabs[0].id);
  });
}
```

- [ ] **Step 3: Update the storage.onChanged handler for enabled**

Replace:

```javascript
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    updateIcon(changes.enabled.newValue !== false);
  }
});
```

with:

```javascript
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    const isEnabled = changes.enabled.newValue !== false;
    updateIcon(isEnabled);
    badge.setEnabled(isEnabled);
  }
});
```

- [ ] **Step 4: Add tab/window/message listeners**

Add this block immediately after the `chrome.storage.onChanged.addListener(...)`
block from Step 3:

```javascript
/**
 * Update the badge when the user switches tabs or windows, and when a content
 * script reports a speed change in the active tab.
 */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  badge.setActiveTab(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || !tabs[0]) {
      return;
    }
    badge.setActiveTab(tabs[0].id);
  });
});

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request && request.type === 'VSC_SPEED') {
    badge.handleSpeedMessage(request.speed, sender.tab?.id);
  }
});
```

- [ ] **Step 5: Verify build and full test suite**

Run: `npm run build && npm test`
Expected: build succeeds (esbuild emits `background.js`), all unit tests PASS.

- [ ] **Step 6: Manual smoke check**

Load the unpacked extension (`dist/` or build output) in Chrome:

1. Open a page with a video, change speed via shortcut/popup → badge shows e.g. `1.5`.
2. Set speed back to 1.0x → badge shows `1`.
3. Switch to a tab with no video → badge is empty.
4. Switch back → badge shows that tab's speed.
5. Toggle the extension off in the popup → badge clears; toggle on → badge returns.

- [ ] **Step 7: Commit**

```bash
git add src/background.js
git commit -m "feat(badge): show active tab speed on the toolbar icon"
```

---

## Self-Review Notes

- **Spec coverage:** always-show incl. 1.0x (Task 1 `1→"1"`); single global active-tab value (Task 2 active-tab gating + Task 5 tab/focus sync); clear on disabled (Task 2 `setEnabled(false)`, Task 5 storage handler); clear on no media (Task 2 null/lastError); ratechange relay incl. native events (Task 4); badge color (Task 2 `init`); format ≤4 chars trailing-zero trim (Task 1). All covered.
- **Type consistency:** message type `VSC_SPEED` and `VSC_GET_SPEED`, method names `setEnabled`/`setActiveTab`/`handleSpeedMessage`/`refreshFromActiveTab`/`init` are identical across Tasks 2, 4, 5.
- **No placeholders:** every code step contains full code.
