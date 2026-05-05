# ChatGPT Extension Window Reliability

## Problem

The `based-blink.chatgpt.extension-image-transform` workflow can stall before it starts real work when it targets a tab that disappears, is reused by the user, or is no longer active enough for ChatGPT to keep generating responses. In the observed run, the workflow entered `waiting_manual` with:

> The Based BLINK browser controller could not open or connect to the tracked ChatGPT page. Reload the extension in the intended browser profile, then resume this run.

This is not acceptable as the normal path. BLINK workflows should run end-to-end without user intervention whenever the target site is authenticated and usable.

## Why Current Behavior Is Fragile

- Extension-backed runs may target an existing ChatGPT tab that is already in use.
- A normal tab can be closed, navigated, suspended, hidden behind other work, or lose the active state before the run attaches.
- ChatGPT image generation may not progress reliably if the run is not operating in an active browser surface.
- When the background browser controller is not connected, the workflow cannot open a replacement tab through the extension and falls back to `waiting_manual`.
- `waiting_manual` can be missed by the user unless the app actively surfaces it.

## Desired Behavior

Extension-backed ChatGPT workflows should prefer an isolated browser surface owned by the run:

1. Open a new Chrome window through the BLINK extension controller, not through OS URL routing.
2. Create the routed ChatGPT tab inside that new window.
3. Keep the run-owned window/tab focused or at least known-active while commands and generation waits are in progress.
4. Record the controller id, window id, tab id, routing token, URL, and client id in the run checkpoint.
5. On resume, prefer the recorded tab; if it is gone, use the extension controller to open a replacement run-owned window using the last known URL/routing token.
6. Treat `waiting_manual` as a last resort only after automatic controller/window recovery fails.

## Notification Requirement

If a workflow does enter `waiting_manual`, the user needs a hard-to-miss notification. Options to evaluate:

- App-level toast or modal for newly waiting runs.
- System notification from Electron.
- Badge/count in the run list.
- Optional sound or persistent notification for unattended automation.
- CLI/watch output that clearly states the manual action and run id.

This should not replace automatic recovery. It is only the fallback path when login, verification, account checks, or unrecoverable extension/controller loss blocks the run.

## Implementation Direction

- Extend the generic extension controller command set from `open-tab` to include `open-window`.
- Have `open-window` call `chrome.windows.create({ url, focused: true })`.
- Return `windowId`, `tabId`, `url`, and `title` to the app.
- Update `sdk.extension.browser.ensureRoutedTab` or add a sibling helper that can request a run-owned window.
- Update ChatGPT plugin workflow inputs/checkpoints to use the run-owned window path by default.
- Keep site-specific ChatGPT URL, selectors, and sequencing in the ChatGPT plugin. The extension should stay site-agnostic.
- Add tests for controller command queueing, window open success/failure, resume fallback order, and manual-wait notification behavior.

## Acceptance Criteria

- A fresh `based-blink.chatgpt.extension-image-transform` run opens a new extension-owned Chrome window.
- The workflow does not target arbitrary existing ChatGPT tabs by default.
- If the tab is closed mid-run, resume can recover through the extension controller without user intervention when possible.
- `waiting_manual` is only used for genuine human-required states or unrecoverable controller loss.
- When `waiting_manual` happens, the user receives a visible notification.

