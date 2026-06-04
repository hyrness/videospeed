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
