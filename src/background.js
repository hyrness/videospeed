/**
 * Update extension icon based on enabled state
 * @param {boolean} enabled - Whether extension is enabled
 */
async function updateIcon(enabled) {
  try {
    const suffix = enabled ? '' : '_disabled';
    await chrome.action.setIcon({
      path: {
        19: `assets/icons/icon19${suffix}.png`,
        38: `assets/icons/icon38${suffix}.png`,
        48: `assets/icons/icon48${suffix}.png`,
      },
    });
    console.log(`Icon updated: ${enabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('Failed to update icon:', error);
  }
}

/**
 * Initialize icon state from storage
 */
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

/**
 * Migrate storage to current config version
 * Removes deprecated keys from older versions
 */
async function migrateConfig() {
  const DEPRECATED_KEYS = [
    // Removed in v0.9.x
    'speeds',
    'version',

    // Replaced by smarter fight-back defaults in event-manager.js
    'forceLastSavedSpeed',

    // Migrated to keyBindings array in v0.6.x
    'resetSpeed',
    'speedStep',
    'fastSpeed',
    'rewindTime',
    'advanceTime',
    'resetKeyCode',
    'slowerKeyCode',
    'fasterKeyCode',
    'rewindKeyCode',
    'advanceKeyCode',
    'fastKeyCode',
    'displayKeyCode',
  ];

  try {
    await chrome.storage.sync.remove(DEPRECATED_KEYS);
    console.log('[VSC] Config migrated to current version');
  } catch (error) {
    console.error('[VSC] Config migration failed:', error);
  }
}

// ---------------------------------------------------------------------------
// Key-binding schema v2 migration: keyCode integers → event.code strings
// ---------------------------------------------------------------------------
// Runs in the background service worker (direct chrome.storage.sync access,
// guaranteed persistence). Content scripts that load before this completes
// use the legacy keyCode fallback path in event-manager.js.

import {
  PREDEFINED_CODE_MAP,
  KEYCODE_TO_CODE,
  displayKeyFromCode,
  PREDEFINED_ACTIONS,
  DEFAULT_BINDINGS,
} from './utils/key-maps.js';

import { createBadgeController } from './core/speed-badge.js';

const badge = createBadgeController(chrome);
badge.init();

/**
 * Migrate key bindings from v1 (keyCode integers) to v2 (event.code strings).
 *
 * Four phases:
 *   1. Predefined bindings — hardcoded map, zero ambiguity
 *   2. Custom bindings — KEYCODE_TO_CODE best-effort lookup
 *   3. Unmappable keyCodes — set code: null (already broken, user re-records)
 *   4. Ensure all 9 predefined actions exist (replaces ensureDisplayBinding)
 *
 * Single atomic chrome.storage.sync.set() call. Idempotent — safe to re-run.
 */
async function migrateKeyBindingsV2() {
  try {
    const storage = await chrome.storage.sync.get(null);
    const bindings = storage.keyBindings;

    // No bindings in storage → fresh install, v2 defaults applied directly
    if (!bindings || !Array.isArray(bindings) || bindings.length === 0) {
      console.log('[VSC] Migration: no keyBindings in storage, skipping (fresh install)');
      return;
    }

    // Idempotency: skip if already fully migrated.
    // Don't trust schemaVersion alone — verify bindings actually have code fields.
    if (storage.schemaVersion === 2 && bindings.every((b) => b.code !== undefined)) {
      console.log('[VSC] Migration: already at v2, skipping');
      return;
    }

    let predefinedCount = 0;
    let customCount = 0;
    let unmappableCount = 0;

    const migrated = bindings.map((binding) => {
      // Per-binding idempotency: skip if already has code field
      if (binding.code !== undefined) {
        return binding;
      }

      const legacyKey = binding.key;

      // Phase 1: Predefined bindings — hardcoded zero-ambiguity mapping
      if (binding.predefined && PREDEFINED_CODE_MAP[legacyKey]) {
        const mapped = PREDEFINED_CODE_MAP[legacyKey];
        predefinedCount++;
        return {
          ...binding,
          code: mapped.code,
          keyCode: legacyKey,
          displayKey: mapped.displayKey,
        };
      }

      // Phase 2: Custom bindings — best-effort KEYCODE_TO_CODE lookup
      const code = KEYCODE_TO_CODE[legacyKey];
      if (code) {
        customCount++;
        return {
          ...binding,
          code: code,
          keyCode: legacyKey,
          displayKey: displayKeyFromCode(code),
        };
      }

      // Phase 3: Unmappable keyCodes (0, null, 255, OEM-specific, etc.)
      unmappableCount++;
      console.info(
        `[VSC] Migration: unmappable keyCode ${legacyKey} for action "${binding.action}"`
      );
      return {
        ...binding,
        code: null,
        keyCode: legacyKey,
        displayKey: '',
      };
    });

    // Phase 4: Ensure all 9 predefined actions exist
    const existingActions = new Set(migrated.map((b) => b.action));
    for (const action of PREDEFINED_ACTIONS) {
      if (!existingActions.has(action)) {
        const defaults = DEFAULT_BINDINGS[action];
        migrated.push({
          action,
          ...defaults,
          predefined: true,
        });
        console.info(`[VSC] Migration: added missing predefined action "${action}"`);
      }
    }

    // Single atomic write
    await chrome.storage.sync.set({
      keyBindings: migrated,
      schemaVersion: 2,
    });

    console.log(
      `[VSC] Migration: ${predefinedCount} predefined, ${customCount} custom (${unmappableCount} unmappable)`
    );
  } catch (error) {
    console.error('[VSC] Key binding migration failed:', error);
  }
}

/**
 * Listen for storage changes (extension enabled/disabled)
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    const isEnabled = changes.enabled.newValue !== false;
    updateIcon(isEnabled);
    badge.setEnabled(isEnabled);
  }
});

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

// A page load/reload re-injects the content script but fires no tab-activation
// event, and a video sitting at its default rate emits no ratechange — so
// neither the push nor the existing pull paths refresh the badge. Re-pull when
// the *active* tab finishes loading so the badge tracks reloads and navigations.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') {
    return;
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || !tabs[0]) {
      return;
    }
    if (tabs[0].id === tabId) {
      badge.setActiveTab(tabId);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request && request.type === 'VSC_SPEED') {
    badge.handleSpeedMessage(request.speed, sender.tab?.id);
  }
});

/**
 * Initialize on install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Video Speed Controller installed/updated');
  await migrateConfig();
  await migrateKeyBindingsV2();
  await initializeIcon();
});

/**
 * Initialize on startup
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('Video Speed Controller started');
  await initializeIcon();
});

// Initialize immediately when service worker loads
initializeIcon();

console.log('Video Speed Controller background script loaded');
