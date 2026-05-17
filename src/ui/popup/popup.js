import { formatSpeed, isPresetMatch, clampSpeed, isValidSpeed } from './popup-helpers.js';
import { normalizeHostname, getDomainSpeed } from '../../utils/hostname.js';

// Message type constants
const MessageTypes = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
};

const VALID_SCOPES = ['tab', 'domain', 'global'];

// Preferred reset speed (the value applied when the center button is clicked).
// Captured from key bindings during init; defaults to 1.0.
let preferredResetSpeed = 1.0;
// Last known playback speed (mirrors chrome.storage.sync.lastSpeed for Global,
// or the active scope's stored value). null = "no user choice yet" — fall back
// to preferredResetSpeed for display.
let currentSpeed = null;
// User-selected scope for popup speed writes ('tab' | 'domain' | 'global').
let currentScope = 'global';
// Active tab's normalized hostname (null if popup opened on a non-http(s) tab).
let activeHostname = null;
// Cached domainSpeeds map from storage (kept in sync via storage.onChanged).
let domainSpeedsCache = {};

document.addEventListener('DOMContentLoaded', () => {
  loadSettingsAndInitialize();

  document.querySelector('#config').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.querySelector('#disable').addEventListener('click', function () {
    const isCurrentlyEnabled = !this.classList.contains('disabled');
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

  chrome.storage.sync.get({ enabled: true }, (storage) => {
    toggleEnabledUI(storage.enabled);
  });

  // Scope selector
  document.querySelectorAll('.scope-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.dataset.scope;
      if (!VALID_SCOPES.includes(scope)) {
        return;
      }
      setScope(scope);
    });
  });

  // Clear domain override
  document.querySelector('#scope-clear').addEventListener('click', clearDomainOverride);

  function toggleEnabled(enabled, callback) {
    chrome.storage.sync.set({ enabled }, () => {
      toggleEnabledUI(enabled);
      if (callback) {
        callback(enabled);
      }
    });
  }

  function toggleEnabledUI(enabled) {
    const disableBtn = document.querySelector('#disable');
    disableBtn.classList.toggle('disabled', !enabled);
    disableBtn.title = enabled ? 'Disable Extension' : 'Enable Extension';
  }

  function settingsSavedReloadMessage(enabled) {
    setStatusMessage(`${enabled ? 'Enabled' : 'Disabled'}. Reload page.`);
  }

  function setStatusMessage(str) {
    const status_element = document.querySelector('#status');
    status_element.classList.toggle('hide', false);
    status_element.innerText = str;
  }

  // ---- Initialization ----------------------------------------------------

  function loadSettingsAndInitialize() {
    // Get active tab info first; hostname determines Domain scope viability.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      activeHostname = tab && tab.url ? normalizeHostname(tab.url) : null;

      chrome.storage.sync.get(null, (storage) => {
        let slowerStep = 0.1;
        let fasterStep = 0.1;
        let resetSpeed = 1.0;

        if (storage.keyBindings && Array.isArray(storage.keyBindings)) {
          const slowerBinding = storage.keyBindings.find((kb) => kb.action === 'slower');
          const fasterBinding = storage.keyBindings.find((kb) => kb.action === 'faster');
          const fastBinding = storage.keyBindings.find((kb) => kb.action === 'fast');

          if (slowerBinding && typeof slowerBinding.value === 'number') {
            slowerStep = slowerBinding.value;
          }
          if (fasterBinding && typeof fasterBinding.value === 'number') {
            fasterStep = fasterBinding.value;
          }
          if (fastBinding && typeof fastBinding.value === 'number') {
            resetSpeed = fastBinding.value;
          }
        }

        preferredResetSpeed = resetSpeed;
        domainSpeedsCache =
          storage.domainSpeeds && typeof storage.domainSpeeds === 'object'
            ? storage.domainSpeeds
            : {};
        currentScope = VALID_SCOPES.includes(storage.popupScope) ? storage.popupScope : 'global';
        currentSpeed = resolveDisplaySpeed(storage);

        updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed);
        renderScopeUI();
        renderCurrentSpeed();
        initializeSpeedControls();
      });
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') {
        return;
      }

      if (changes.domainSpeeds) {
        domainSpeedsCache =
          changes.domainSpeeds.newValue && typeof changes.domainSpeeds.newValue === 'object'
            ? changes.domainSpeeds.newValue
            : {};
        renderScopeUI();
        if (currentScope === 'domain') {
          currentSpeed = getDomainSpeed(domainSpeedsCache, activeHostname);
          renderCurrentSpeed();
        }
      }

      if (changes.lastSpeed && currentScope === 'global') {
        const next = changes.lastSpeed.newValue;
        currentSpeed = isValidSpeed(next) ? next : null;
        renderCurrentSpeed();
      }
    });
  }

  // Pick the display value for the current scope from the raw storage object.
  function resolveDisplaySpeed(storage) {
    if (currentScope === 'domain') {
      return getDomainSpeed(
        storage.domainSpeeds && typeof storage.domainSpeeds === 'object'
          ? storage.domainSpeeds
          : {},
        activeHostname
      );
    }
    if (currentScope === 'global') {
      return isValidSpeed(storage.lastSpeed) ? storage.lastSpeed : null;
    }
    // 'tab' scope has no stored value — start at the current global as a hint.
    return isValidSpeed(storage.lastSpeed) ? storage.lastSpeed : null;
  }

  // ---- Scope UI ----------------------------------------------------------

  function setScope(scope) {
    if (!VALID_SCOPES.includes(scope)) {
      return;
    }
    currentScope = scope;
    chrome.storage.sync.set({ popupScope: scope });
    chrome.storage.sync.get(null, (storage) => {
      currentSpeed = resolveDisplaySpeed(storage);
      renderScopeUI();
      renderCurrentSpeed();
    });
  }

  function renderScopeUI() {
    document.querySelectorAll('.scope-tab').forEach((btn) => {
      const isActive = btn.dataset.scope === currentScope;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    const hostnameEl = document.querySelector('#scope-hostname');
    const clearBtn = document.querySelector('#scope-clear');
    const domainTab = document.querySelector('.scope-tab[data-scope="domain"]');

    // Domain scope only makes sense on http(s) tabs.
    if (domainTab) {
      domainTab.disabled = !activeHostname;
      domainTab.title = activeHostname ? '' : 'Domain scope unavailable here';
    }

    if (currentScope === 'domain') {
      if (activeHostname) {
        const stored = getDomainSpeed(domainSpeedsCache, activeHostname);
        hostnameEl.textContent =
          stored !== null ? `${activeHostname} • saved ${formatSpeed(stored)}×` : activeHostname;
        clearBtn.classList.toggle('hide', stored === null);
      } else {
        hostnameEl.textContent = 'No domain on this tab';
        clearBtn.classList.add('hide');
      }
    } else if (currentScope === 'tab') {
      hostnameEl.textContent = 'One-off — not persisted';
      clearBtn.classList.add('hide');
    } else {
      hostnameEl.textContent = 'Applies everywhere';
      clearBtn.classList.add('hide');
    }
  }

  function clearDomainOverride() {
    if (!activeHostname) {
      return;
    }
    const next = { ...domainSpeedsCache };
    delete next[activeHostname];
    chrome.storage.sync.set({ domainSpeeds: next }, () => {
      domainSpeedsCache = next;
      if (currentScope === 'domain') {
        currentSpeed = null;
      }
      renderScopeUI();
      renderCurrentSpeed();
    });
  }

  // ---- Speed display -----------------------------------------------------

  function renderCurrentSpeed() {
    const speedForDisplay = currentSpeed === null ? preferredResetSpeed : currentSpeed;
    const resetBtn = document.querySelector('#speed-reset');
    if (resetBtn) {
      resetBtn.textContent = formatSpeed(speedForDisplay);
    }
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      const presetSpeed = parseFloat(btn.dataset.speed);
      btn.classList.toggle('active', isPresetMatch(speedForDisplay, presetSpeed));
    });
  }

  function updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed) {
    const decreaseBtn = document.querySelector('#speed-decrease');
    if (decreaseBtn) {
      decreaseBtn.dataset.delta = -slowerStep;
      decreaseBtn.querySelector('span').textContent = `-${slowerStep}`;
    }
    const increaseBtn = document.querySelector('#speed-increase');
    if (increaseBtn) {
      increaseBtn.dataset.delta = fasterStep;
      increaseBtn.querySelector('span').textContent = `+${fasterStep}`;
    }
    const resetBtn = document.querySelector('#speed-reset');
    if (resetBtn) {
      resetBtn.textContent = resetSpeed.toString();
    }
  }

  // ---- Speed controls ----------------------------------------------------

  function initializeSpeedControls() {
    const applyOptimistic = (speed) => {
      currentSpeed = clampSpeed(speed);
      renderCurrentSpeed();
      persistForScope(currentSpeed);
    };

    document.querySelector('#speed-decrease').addEventListener('click', function () {
      const delta = parseFloat(this.dataset.delta);
      sendSpeedDelta(delta);
      const base = currentSpeed === null ? preferredResetSpeed : currentSpeed;
      applyOptimistic(base + delta);
    });

    document.querySelector('#speed-increase').addEventListener('click', function () {
      const delta = parseFloat(this.dataset.delta);
      sendSpeedDelta(delta);
      const base = currentSpeed === null ? preferredResetSpeed : currentSpeed;
      applyOptimistic(base + delta);
    });

    document.querySelector('#speed-reset').addEventListener('click', () => {
      sendSpeed(preferredResetSpeed);
      applyOptimistic(preferredResetSpeed);
    });

    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        const speed = parseFloat(this.dataset.speed);
        sendSpeed(speed);
        applyOptimistic(speed);
      });
    });
  }

  // Persist the new speed according to the active scope.
  // Tab: nothing. Domain: domainSpeeds[host]. Global: lastSpeed.
  function persistForScope(speed) {
    if (!isValidSpeed(speed)) {
      return;
    }
    if (currentScope === 'tab') {
      return;
    }
    if (currentScope === 'domain') {
      if (!activeHostname) {
        return;
      }
      const next = { ...domainSpeedsCache, [activeHostname]: speed };
      domainSpeedsCache = next;
      chrome.storage.sync.set({ domainSpeeds: next }, () => {
        renderScopeUI();
      });
      return;
    }
    if (currentScope === 'global') {
      chrome.storage.sync.set({ lastSpeed: speed });
    }
  }

  // ---- Messaging ---------------------------------------------------------

  // Popup-initiated speed writes use noPersist=true so action-handler skips its
  // rememberSpeed-driven storage write; the popup owns scope-aware persistence.
  // We do NOT send source='external' because that would prevent the in-memory
  // lastSpeed update, leaving event-manager's fight-back to revert to a stale value.
  function sendSpeed(speed) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageTypes.SET_SPEED,
          payload: { speed, noPersist: true },
        });
      }
    });
  }

  function sendSpeedDelta(delta) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageTypes.ADJUST_SPEED,
          payload: { delta, noPersist: true },
        });
      }
    });
  }
});
