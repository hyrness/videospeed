# Speed Badge on Toolbar Icon — Design

## Goal

Display the current playback speed of the **active tab** as a text badge on the
extension toolbar icon, so the user can see the current speed without opening
the popup.

## Decisions (confirmed with user)

- **Always show** the current speed, including `1` at 1.0x.
- **Single global badge value** that reflects the **active tab's** current speed
  (not per-tab badges). Switching tabs refreshes the badge to that tab's speed.
- **Clear the badge** (empty text) when the extension is disabled, or when the
  active tab has no `<video>`/`<audio>` media.

## Architecture (Approach A: ratechange relay)

Speed changes flow from the page to the background service worker without
touching `inject.js` / `action-handler.js`:

```
[MAIN]  inject.js setSpeed() → dispatches 'ratechange' CustomEvent on the video
   │     (bubbles: true, composed: true → reaches document)
   ▼     (MAIN and ISOLATED share the DOM)
[ISOLATED] content-bridge: capturing listener on document for 'ratechange'
   │     reads e.target.playbackRate, sends chrome.runtime.sendMessage(
   │       { type: 'VSC_SPEED', speed })
   ▼
[background] if sender.tab is the cached active tab AND enabled:
             chrome.action.setBadgeText({ text: formatSpeedBadge(speed) })
```

Reading `e.target.playbackRate` in the ISOLATED world is safe — the event
target is a shared DOM node, so no cross-world `detail` cloning is required.
This mirrors the existing `VSC_WRITE_STORAGE` MAIN→ISOLATED pattern already in
`content-bridge.js`. Native (site-initiated) `ratechange` events are also
captured, so the badge tracks site-driven speed changes too.

### Why not the alternatives

- **Polling (`VSC_GET_SPEED` on a timer):** no real-time update on keyboard
  changes, wasteful. Rejected.
- **Watching `chrome.storage` `lastSpeed`:** only written when
  `rememberSpeed=true`, missing keyboard-driven changes; it is also a global,
  not active-tab, value. Rejected.

## Components

### 1. `formatSpeedBadge(speed)` — pure function

- Input: a number in `[SPEED_MIN=0.07, SPEED_MAX=16]` (or null/invalid).
- Output: badge string ≤ 4 chars, trailing zeros trimmed.
  - `1.00 → "1"`, `1.50 → "1.5"`, `1.75 → "1.75"`, `2.00 → "2"`,
    `0.07 → "0.07"`, `16 → "16"`.
  - `null`/non-finite → `""` (clears badge).
- Location: a small exported helper so it is unit-testable. Place in
  `src/background.js` (exported) or a tiny util; chosen: export from
  `background.js` for cohesion with badge logic, re-exported for tests.

### 2. `content-bridge.js` additions (ISOLATED world)

- Add a capturing listener: `document.addEventListener('ratechange', handler, true)`.
- Handler: if `e.target` is a media element (`HTMLMediaElement`), read
  `e.target.playbackRate`; `chrome.runtime.sendMessage({ type: 'VSC_SPEED', speed })`.
- Guard against `Extension context invalidated` (remove listener), consistent
  with the existing `handleWriteStorage` pattern.
- No change to the existing `VSC_GET_SPEED` responder (still used by the popup
  and now by the background tab-activation pull).

### 3. `background.js` additions

- **Active-tab cache:** `currentActiveTabId`, updated on
  `chrome.tabs.onActivated` and `chrome.windows.onFocusChanged`
  (use the focused window's active tab; ignore `WINDOW_ID_NONE`).
- **`VSC_SPEED` listener:** in `chrome.runtime.onMessage`, when
  `request.type === 'VSC_SPEED'` and `sender.tab?.id === currentActiveTabId`
  and the extension is enabled → `setBadgeText({ text: formatSpeedBadge(speed) })`.
- **Tab activation / focus change:** after updating `currentActiveTabId`,
  refresh the badge by sending `VSC_GET_SPEED` to the active tab and applying
  `formatSpeedBadge` to the response (`null`/no media → `""`). Tolerate
  `chrome.runtime.lastError` (e.g. restricted pages with no content script) by
  clearing the badge.
- **Enabled state:** extend the existing `chrome.storage.onChanged` handler —
  when `enabled` becomes false → `setBadgeText({ text: '' })`; when true →
  refresh from the active tab.
- **Badge color:** call `chrome.action.setBadgeBackgroundColor({ color })` once
  during init for legibility (neutral/dark color).
- Track an in-memory `enabled` flag (initialized in `initializeIcon`) so the
  message listener can gate without an async storage read per message.

## Data flow summary

| Trigger                        | Path                                             | Result                           |
| ------------------------------ | ------------------------------------------------ | -------------------------------- |
| Speed change in active tab     | ratechange → content-bridge → `VSC_SPEED`        | badge = new speed                |
| Speed change in background tab | `VSC_SPEED` (sender ≠ active)                    | ignored                          |
| Switch / focus tab             | `onActivated`/`onFocusChanged` → `VSC_GET_SPEED` | badge = that tab's speed (or "") |
| Active tab has no media        | `VSC_GET_SPEED` → null                           | badge = ""                       |
| Extension disabled             | `storage.onChanged enabled=false`                | badge = ""                       |
| Extension re-enabled           | `storage.onChanged enabled=true`                 | badge refreshed from active tab  |

## Error handling

- content-bridge: swallow / teardown listener on `Extension context invalidated`.
- background: guard every `chrome.tabs.sendMessage` with a `lastError` check;
  on error, clear the badge rather than throwing.
- `formatSpeedBadge` never throws — invalid input → `""`.

## Testing (TDD)

1. **`formatSpeedBadge` unit tests:** `1.00→"1"`, `1.50→"1.5"`, `1.75→"1.75"`,
   `2→"2"`, `0.07→"0.07"`, `16→"16"`, `null→""`, `NaN→""`, out-of-range handled.
2. **content-bridge:** dispatching a `ratechange` on a media element triggers
   `chrome.runtime.sendMessage({type:'VSC_SPEED', speed})` with the element's
   `playbackRate`; non-media targets are ignored. Add to existing
   `tests/unit/content/content-bridge.test.js`.
3. **background badge logic:**
   - `VSC_SPEED` from the active tab while enabled → `setBadgeText` with
     formatted value.
   - `VSC_SPEED` from a non-active tab → no `setBadgeText`.
   - `enabled=false` change → `setBadgeText({text:''})`.
   - tab activation with media → badge set; with no media/null → badge cleared.

## Out of scope

- Per-tab independent badges.
- Configurable badge color / format in options.
- Showing speed for tabs that were never visited.
