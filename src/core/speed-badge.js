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
 * Two-digit speeds drop to one decimal (12.75→"12.8") so the badge stays
 * within ~4 chars, which is all Chrome reliably renders.
 * Invalid / null / non-finite input clears the badge ("").
 *
 * @param {number} speed
 * @returns {string}
 */
export function formatSpeedBadge(speed) {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) {
    return '';
  }
  const decimals = speed >= 10 ? 1 : 2;
  return speed.toFixed(decimals).replace(/\.?0+$/, '');
}

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
    if (!enabled || activeTabId === null) {
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
    handleSpeedMessage(speed, senderTabId, isActiveTab) {
      // Trust the sender's own active flag rather than the cached activeTabId:
      // an MV3 service worker idles out and loses activeTabId, and wakes up ON
      // this very message before the async re-sync restores it — gating on the
      // cache would drop the update (e.g. keyboard speed changes never showed).
      if (!enabled || !isActiveTab) {
        return;
      }
      if (typeof senderTabId === 'number') {
        activeTabId = senderTabId; // keep the pull target fresh for later refreshes
      }
      applyBadge(formatSpeedBadge(speed));
    },
    refreshFromActiveTab,
  };
}
