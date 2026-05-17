import { formatSpeed, isPresetMatch, clampSpeed, isValidSpeed } from './popup-helpers.js';

// Message type constants
const MessageTypes = {
  SET_SPEED: 'VSC_SET_SPEED',
  ADJUST_SPEED: 'VSC_ADJUST_SPEED',
  RESET_SPEED: 'VSC_RESET_SPEED',
  TOGGLE_DISPLAY: 'VSC_TOGGLE_DISPLAY',
};

// Preferred reset speed (the value applied when the center button is clicked).
// Captured from key bindings during init; defaults to 1.0.
let preferredResetSpeed = 1.0;
// Last known playback speed (mirrors chrome.storage.sync.lastSpeed).
// null = "no user choice yet" — fall back to preferredResetSpeed for display.
let currentSpeed = null;

document.addEventListener('DOMContentLoaded', () => {
  // Load settings and initialize speed controls
  loadSettingsAndInitialize();

  // Settings button event listener
  document.querySelector('#config').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Power button toggle event listener
  document.querySelector('#disable').addEventListener('click', function () {
    // Toggle based on current state
    const isCurrentlyEnabled = !this.classList.contains('disabled');
    toggleEnabled(!isCurrentlyEnabled, settingsSavedReloadMessage);
  });

  // Initialize enabled state
  chrome.storage.sync.get({ enabled: true }, (storage) => {
    toggleEnabledUI(storage.enabled);
  });

  function toggleEnabled(enabled, callback) {
    chrome.storage.sync.set(
      {
        enabled: enabled,
      },
      () => {
        toggleEnabledUI(enabled);
        if (callback) {
          callback(enabled);
        }
      }
    );
  }

  function toggleEnabledUI(enabled) {
    const disableBtn = document.querySelector('#disable');
    disableBtn.classList.toggle('disabled', !enabled);

    // Update tooltip
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

  // Load settings and initialize UI
  function loadSettingsAndInitialize() {
    chrome.storage.sync.get(null, (storage) => {
      // Find the step values from keyBindings
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
      currentSpeed = isValidSpeed(storage.lastSpeed) ? storage.lastSpeed : null;

      // Update the UI with dynamic values
      updateSpeedControlsUI(slowerStep, fasterStep, resetSpeed);
      renderCurrentSpeed();

      // Initialize event listeners
      initializeSpeedControls();
    });

    // Live updates: another tab (or the content script) writing lastSpeed
    // should reflect in the open popup without a refresh.
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes.lastSpeed) {
        return;
      }
      const next = changes.lastSpeed.newValue;
      currentSpeed = isValidSpeed(next) ? next : null;
      renderCurrentSpeed();
    });
  }

  // Reflect currentSpeed into the center display + active preset highlight.
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
    // Update decrease button
    const decreaseBtn = document.querySelector('#speed-decrease');
    if (decreaseBtn) {
      decreaseBtn.dataset.delta = -slowerStep;
      decreaseBtn.querySelector('span').textContent = `-${slowerStep}`;
    }

    // Update increase button
    const increaseBtn = document.querySelector('#speed-increase');
    if (increaseBtn) {
      increaseBtn.dataset.delta = fasterStep;
      increaseBtn.querySelector('span').textContent = `+${fasterStep}`;
    }

    // Update reset button
    const resetBtn = document.querySelector('#speed-reset');
    if (resetBtn) {
      resetBtn.textContent = resetSpeed.toString();
    }
  }

  // Speed Control Functions
  function initializeSpeedControls() {
    const applyOptimistic = (speed) => {
      currentSpeed = clampSpeed(speed);
      renderCurrentSpeed();
    };

    // Set up speed control button listeners
    document.querySelector('#speed-decrease').addEventListener('click', function () {
      const delta = parseFloat(this.dataset.delta);
      adjustSpeed(delta);
      const base = currentSpeed === null ? preferredResetSpeed : currentSpeed;
      applyOptimistic(base + delta);
    });

    document.querySelector('#speed-increase').addEventListener('click', function () {
      const delta = parseFloat(this.dataset.delta);
      adjustSpeed(delta);
      const base = currentSpeed === null ? preferredResetSpeed : currentSpeed;
      applyOptimistic(base + delta);
    });

    document.querySelector('#speed-reset').addEventListener('click', () => {
      // Reset to the configured preferred speed, not the displayed (current) value.
      setSpeed(preferredResetSpeed);
      applyOptimistic(preferredResetSpeed);
    });

    // Set up preset button listeners
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        const speed = parseFloat(this.dataset.speed);
        setSpeed(speed);
        applyOptimistic(speed);
      });
    });
  }

  function setSpeed(speed) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageTypes.SET_SPEED,
          payload: { speed: speed },
        });
      }
    });
  }

  function adjustSpeed(delta) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MessageTypes.ADJUST_SPEED,
          payload: { delta: delta },
        });
      }
    });
  }
});
