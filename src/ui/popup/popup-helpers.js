/**
 * Pure helpers for popup current-speed display.
 *
 * Kept side-effect free so they can be unit-tested without jsdom popup setup.
 */

const EPSILON = 0.001;

export function isValidSpeed(speed) {
  return typeof speed === 'number' && Number.isFinite(speed);
}

/**
 * Format a speed value for display.
 * 1     -> "1"
 * 1.0   -> "1"
 * 1.5   -> "1.5"
 * 1.25  -> "1.25"
 * 0.30000000000000004 -> "0.3"
 */
export function formatSpeed(speed) {
  if (!isValidSpeed(speed)) {
    return '1';
  }
  return Number(speed.toFixed(2)).toString();
}

/**
 * Returns true if `speed` matches `preset` within float tolerance.
 */
export function isPresetMatch(speed, preset) {
  if (!isValidSpeed(speed) || !isValidSpeed(preset)) {
    return false;
  }
  return Math.abs(speed - preset) < EPSILON;
}

/**
 * Clamp speed to allowed range, rounded to 2 decimals.
 * Mirrors SPEED_MIN/SPEED_MAX in content-bridge.js trust-boundary check.
 */
export function clampSpeed(speed, min = 0.07, max = 16) {
  if (!isValidSpeed(speed)) {
    return min;
  }
  const clamped = Math.min(Math.max(speed, min), max);
  return Number(clamped.toFixed(2));
}
