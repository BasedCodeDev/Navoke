chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "focus-current-tab") return false;

  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (typeof tabId !== "number" || typeof windowId !== "number") {
    sendResponse({ ok: false, error: "Could not identify the sender tab to focus." });
    return false;
  }

  Promise.all([
    chrome.tabs.update(tabId, { active: true }),
    chrome.windows.update(windowId, { focused: true })
  ])
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});
