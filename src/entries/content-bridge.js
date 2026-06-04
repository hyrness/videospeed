/**
 * Content Bridge — ISOLATED world thin bridge for chrome.* API access.
 *
 * Runs at document_start. Communicates with inject.js (MAIN world) via
 * CustomEvents on document.documentElement.
 *
 * Settings handshake:
 *   1. Bridge stashes settings in closure, registers VSC_REQUEST_SETTINGS listener
 *   2. MAIN world fires VSC_REQUEST_SETTINGS at document_idle
 *   3. Bridge responds with VSC_SETTINGS_READY (synchronous within same tick)
 */

import { isBlacklisted } from '../utils/blacklist.js';
import { matchSiteRule } from '../utils/site-pattern.js';

// Speed limits for page→bridge write validation.
// Duplicated from constants.js (ISOLATED world can't import page modules).
const SPEED_MIN = 0.07;
const SPEED_MAX = 16;

const docEl = document.documentElement;
let bridgeInitialized = false;

async function init() {
  try {
    // Skip about:blank frames — they share the parent window
    if (location.href === 'about:blank') {
      return;
    }

    // Double-injection guard (module-level flag resets on page navigation)
    if (bridgeInitialized) {
      return;
    }
    bridgeInitialized = true;

    const settings = await chrome.storage.sync.get(null);

    const disabled = settings.enabled === false;
    // Legacy blacklist: only checked when siteRules hasn't been initialized yet
    // (pre-migration devices). Once migration runs, siteRules is the source of
    // truth. The blacklist is preserved in storage for sync compat with older
    // extension versions but must not shadow siteRules edits.
    const blacklisted = !settings.siteRules && isBlacklisted(settings.blacklist, location.href);
    const siteRuleMatch = matchSiteRule(settings.siteRules, location.href);
    const siteDisabled = siteRuleMatch && siteRuleMatch.enabled === false;
    const shouldAbort = disabled || blacklisted || siteDisabled;

    // Always respond — inject.js runs unconditionally and needs the abort
    // signal to skip init. { once: true } limits event forgery exposure.
    if (shouldAbort) {
      docEl.addEventListener(
        'VSC_REQUEST_SETTINGS',
        () => {
          docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: { abort: true } }));
        },
        { once: true }
      );
      return;
    }

    const hostname = location.hostname.replace(/^www\./, '');

    // Strip keys the MAIN world shouldn't see
    delete settings.blacklist;
    delete settings.enabled;

    const settingsPayload = { settings, hostname };

    docEl.addEventListener(
      'VSC_REQUEST_SETTINGS',
      () => {
        docEl.dispatchEvent(new CustomEvent('VSC_SETTINGS_READY', { detail: settingsPayload }));
      },
      { once: true }
    );

    // --- Ongoing: storage change relay + lifecycle ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') {
        return;
      }

      // Lifecycle: only the popup's enabled toggle triggers teardown/reinit.
      // Options page never writes `enabled`, so saving options can't trigger
      // lifecycle — it only relays settings via VSC_STORAGE_CHANGED below.
      // siteRules/blacklist changes take effect on next page load.
      if (changes.enabled?.newValue === false) {
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_TEARDOWN' } }));
        return;
      }
      if (changes.enabled?.oldValue === false && changes.enabled?.newValue !== false) {
        docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: { type: 'VSC_REINIT' } }));
      }

      // Relay changes to MAIN world (filter out keys MAIN never received)
      const relayChanges = { ...changes };
      delete relayChanges.enabled;
      delete relayChanges.blacklist;
      if (Object.keys(relayChanges).length > 0) {
        docEl.dispatchEvent(new CustomEvent('VSC_STORAGE_CHANGED', { detail: relayChanges }));
      }
    });

    // --- Ongoing: popup/background message relay ---
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      // VSC_GET_SPEED: read playbackRate directly from the DOM. The ISOLATED
      // world shares the DOM with the page, so we don't need to route through
      // inject.js. Used by the popup to display the actual current speed,
      // which storage-derived values miss when speed was changed via keyboard
      // (lastSpeed is only written when rememberSpeed=true) or in-page UI.
      if (request && request.type === 'VSC_GET_SPEED') {
        const media = document.querySelectorAll('video, audio');
        let target = null;
        for (const m of media) {
          if (!m.paused) {
            target = m;
            break;
          }
        }
        if (!target && media.length > 0) {
          target = media[0];
        }
        sendResponse({ speed: target ? target.playbackRate : null });
        return;
      }
      docEl.dispatchEvent(new CustomEvent('VSC_MESSAGE', { detail: request }));
    });

    // --- Ongoing: speed write-back from MAIN world ---
    const handleWriteStorage = (e) => {
      try {
        const data = e.detail;
        if (!data || typeof data !== 'object') {
          return;
        }

        // Only lastSpeed can be written from MAIN world (trust boundary)
        if ('lastSpeed' in data) {
          const speed = data.lastSpeed;
          if (typeof speed === 'number' && Number.isFinite(speed)) {
            const clamped = Math.min(Math.max(speed, SPEED_MIN), SPEED_MAX);
            chrome.storage.sync.set({ lastSpeed: clamped });
          }
        }
      } catch (err) {
        if (err.message?.includes('Extension context invalidated')) {
          docEl.removeEventListener('VSC_WRITE_STORAGE', handleWriteStorage);
        }
      }
    };
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
  } catch (error) {
    console.error('[VSC] Bridge init failed:', error);
  }
}

init();
