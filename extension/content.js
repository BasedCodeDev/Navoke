(() => {
if (globalThis.__navokeBrowserControllerContentStarted) return;
globalThis.__navokeBrowserControllerContentStarted = true;

const NAVOKE_EXTENSION_PROTOCOL_VERSION = 6;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const API_BASE_URL = "http://127.0.0.1:39201";
const ROUTING_TOKEN_PARAM = "navoke-tab";
const LEGACY_BLINK_ROUTING_TOKEN_PARAM = "based-blink-tab";
const CLIENT_ID_STORAGE_KEY = "navokeBrowserClientId";
const ROUTING_TOKEN_STORAGE_KEY = "navokeBrowserRoutingToken";

const memoryStorage = new Map();
let lastControllerHeartbeat = {
  ok: false,
  checkedAt: "",
  error: "Controller heartbeat has not run yet."
};

function safeSessionGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return memoryStorage.get(key) || null;
  }
}

function safeSessionSet(key, value) {
  memoryStorage.set(key, value);
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Some pages can make sessionStorage unavailable to content scripts.
  }
}

let clientId = safeSessionGet(CLIENT_ID_STORAGE_KEY);
if (!clientId) {
  clientId = crypto.randomUUID();
  safeSessionSet(CLIENT_ID_STORAGE_KEY, clientId);
}

function routingTokenFromLocation() {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  for (const param of [ROUTING_TOKEN_PARAM, LEGACY_BLINK_ROUTING_TOKEN_PARAM]) {
    const routingToken = search.get(param) || hash.get(param);
    if (routingToken) return routingToken;
  }
  return undefined;
}

function rememberRoutingTokenFromLocation() {
  const routingToken = routingTokenFromLocation();
  if (routingToken) safeSessionSet(ROUTING_TOKEN_STORAGE_KEY, routingToken);
  return routingToken;
}

function routingTokenForHeartbeat() {
  return rememberRoutingTokenFromLocation() || safeSessionGet(ROUTING_TOKEN_STORAGE_KEY) || undefined;
}

rememberRoutingTokenFromLocation();

function apiUrl(path) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiFetch(path, options = {}) {
  const relayed = await relayApiFetch(path, options);
  if (relayed) return apiFetchBodyFromRelay(relayed);

  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Navoke API request failed with ${response.status}`);
  }
  return body;
}

async function relayApiFetch(path, options = {}) {
  try {
    const result = await chrome.runtime.sendMessage({
      type: "api-fetch",
      path,
      options: {
        method: options.method || "GET",
        headers: options.headers || {},
        ...(options.body !== undefined ? { body: String(options.body) } : {})
      }
    });
    if (result?.type === "api-fetch-result" || result?.type === "api-fetch-error") return result;
  } catch {
    // Fall back to direct fetch for existing pages where the background has not reloaded yet.
  }
  return null;
}

function apiFetchBodyFromRelay(result) {
  if (result.type === "api-fetch-error") {
    throw new Error(result.error || `Navoke API request failed with ${result.status || "unknown status"}`);
  }
  if (result.status === 204) return null;
  if (!result.ok) {
    throw new Error(result.body?.error || result.body?.message || `Navoke API request failed with ${result.status}`);
  }
  return result.body ?? null;
}

async function heartbeat() {
  try {
    const tabInfo = await currentTabInfoForHeartbeat();
    const controllerHeartbeat = await controllerHeartbeatForHeartbeat();
    await apiFetch("/api/extension/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        clientId,
        protocolVersion: NAVOKE_EXTENSION_PROTOCOL_VERSION,
        extensionVersion: EXTENSION_VERSION,
        url: location.href,
        title: document.title,
        routingToken: routingTokenForHeartbeat(),
        ...(typeof tabInfo.controllerId === "string" ? { controllerId: tabInfo.controllerId } : {}),
        ...(typeof tabInfo.tabId === "number" ? { tabId: tabInfo.tabId } : {}),
        ...(typeof tabInfo.windowId === "number" ? { windowId: tabInfo.windowId } : {}),
        controllerHeartbeatOk: controllerHeartbeat.ok === true,
        controllerHeartbeatAt: controllerHeartbeat.checkedAt,
        ...(controllerHeartbeat.ok === true ? {} : { controllerHeartbeatError: controllerHeartbeat.error || "Unknown controller heartbeat failure" }),
        capabilities: ["inspect", "action", "wait", "extract", "focus"]
      })
    });
  } catch {
    // The Electron app may not be running. Keep polling quietly.
  }
}

async function controllerHeartbeatForHeartbeat() {
  const checkedAt = new Date().toISOString();
  try {
    const result = await chrome.runtime.sendMessage({ type: "controller-heartbeat" });
    const ok = result?.ok === true && result?.controllerHeartbeat?.ok !== false;
    lastControllerHeartbeat = {
      ok,
      checkedAt,
      ...(ok
        ? { controllerId: result?.controllerHeartbeat?.controllerId || result?.controllerId || "" }
        : { error: result?.controllerHeartbeat?.error || result?.error || "Controller heartbeat did not report success." })
    };
  } catch (error) {
    lastControllerHeartbeat = {
      ok: false,
      checkedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  return lastControllerHeartbeat;
}

async function currentTabInfoForHeartbeat() {
  try {
    const result = await chrome.runtime.sendMessage({ type: "current-tab-info" });
    return result?.ok ? result : {};
  } catch {
    return {};
  }
}

async function pollCommands() {
  try {
    const command = await apiFetch(`/api/extension/commands/next?clientId=${encodeURIComponent(clientId)}`);
    if (command) await runCommand(command);
  } catch {
    // Keep polling; the popup exposes connectivity state.
  }
}

async function pollFocusCommands() {
  try {
    const command = await apiFetch(`/api/extension/focus/commands/next?clientId=${encodeURIComponent(clientId)}`);
    if (!command) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: "focus-current-tab" });
      if (!result?.ok) throw new Error(result?.error || "Could not focus browser tab.");
      await apiFetch(`/api/extension/focus/commands/${encodeURIComponent(command.id)}/complete`, {
        method: "POST",
        body: JSON.stringify({ result })
      });
    } catch (error) {
      await apiFetch(`/api/extension/focus/commands/${encodeURIComponent(command.id)}/fail`, {
        method: "POST",
        body: JSON.stringify({ message: error instanceof Error ? error.message : String(error) })
      });
    }
  } catch {
    // Keep polling.
  }
}

async function runCommand(payload) {
  try {
    if (!payload || payload.protocolVersion !== NAVOKE_EXTENSION_PROTOCOL_VERSION || payload.kind !== "browser-command") {
      throw new Error("Unsupported Navoke browser command payload.");
    }
    const result = await performCommand(payload.command);
    await apiFetch(`/api/extension/commands/${encodeURIComponent(payload.id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ result })
    });
  } catch (error) {
    await apiFetch(`/api/extension/commands/${encodeURIComponent(payload.id)}/fail`, {
      method: "POST",
      body: JSON.stringify({ message: error instanceof Error ? error.message : String(error) })
    });
  }
}

async function performCommand(command) {
  if (!command || typeof command !== "object") throw new Error("Navoke browser command is required.");
  if (command.kind === "inspect") return collectPageState();
  if (command.kind === "action") return performAction(command.action);
  if (command.kind === "wait") return waitForCondition(command.condition);
  if (command.kind === "extract") return extract(command.query);
  throw new Error(`Unsupported Navoke browser command kind: ${command.kind || "unknown"}`);
}

function requireSelector(selector) {
  if (typeof selector !== "string" || selector.trim().length === 0) throw new Error("A CSS selector is required.");
  return selector.trim();
}

function firstElement(selector) {
  const element = elementsForSelector(selector)[0] || null;
  if (!element) throw new Error(`Element not found: ${selector}`);
  return element;
}

function elementsForSelector(selector) {
  const normalized = normalizeSelectorForDom(requireSelector(selector));
  if (normalized.textSelector) return textSelectorElements(normalized.textSelector);

  let elements;
  try {
    elements = Array.from(document.querySelectorAll(normalized.cssSelector));
  } catch (error) {
    throw new Error(`Invalid selector: ${selector}; normalized=${normalized.cssSelector}; ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!normalized.textFilter) return elements;
  return elements.filter((element) => elementMatchesTextFilter(element, normalized.textFilter));
}

function normalizeSelectorForDom(selector) {
  const trimmed = selector.trim();
  if (trimmed.startsWith("text=")) {
    return { cssSelector: "*", textSelector: parseTextSelector(trimmed.slice(5).trim()) };
  }

  const textFilters = [];
  const cssSelector = trimmed
    .replace(/:visible\b/g, "")
    .replace(/:has-text\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/g, (_match, quotedText) => {
      textFilters.push(unquoteSelectorText(quotedText));
      return "";
    })
    .trim();

  return {
    cssSelector: cssSelector || "*",
    textFilter:
      textFilters.length > 0
        ? {
            text: textFilters[textFilters.length - 1],
            textMatch: "contains",
            caseSensitive: true
          }
        : null
  };
}

function parseTextSelector(value) {
  if (value.startsWith("/") && value.lastIndexOf("/") > 0) {
    const lastSlash = value.lastIndexOf("/");
    return {
      text: value.slice(1, lastSlash),
      textMatch: "regex",
      caseSensitive: !value.slice(lastSlash + 1).includes("i")
    };
  }
  return {
    text: unquoteSelectorText(value),
    textMatch: "contains",
    caseSensitive: false
  };
}

function unquoteSelectorText(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed.startsWith("'") ? `"${trimmed.slice(1, -1).replace(/"/g, '\\"')}"` : trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function textSelectorElements(filter) {
  const candidates = Array.from(document.querySelectorAll("body *")).filter((element) => elementMatchesTextFilter(element, filter));
  const deepest = candidates.filter((element) => !Array.from(element.children || []).some((child) => elementMatchesTextFilter(child, filter)));
  return deepest.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
  });
}

function firstActionableElement(selector, textFilter) {
  const candidates = elementsForSelector(selector);
  if (candidates.length === 0) throw new Error(`Element not found: ${selector}`);
  const textMatchedElements = textFilter ? candidates.filter((element) => elementMatchesTextFilter(element, textFilter)) : candidates;
  const visibleElements = textMatchedElements.filter(isVisible);
  const enabledElements = textMatchedElements.filter((element) => !isDisabled(element));
  const visibleEnabled = visibleElements.find((element) => !isDisabled(element));
  if (textFilter && !visibleEnabled) {
    throw new Error(
      `No visible enabled text-matching element found for ${selector}; candidates=${candidates.length}; textMatches=${textMatchedElements.length}; visible=${visibleElements.length}; enabled=${enabledElements.length}; text=${textFilter.text}; textMatch=${textFilter.textMatch}; caseSensitive=${textFilter.caseSensitive}`
    );
  }
  return {
    element: visibleEnabled || visibleElements[0] || enabledElements[0] || textMatchedElements[0] || candidates[0],
    candidateCount: candidates.length,
    visibleCount: visibleElements.length,
    enabledCount: enabledElements.length,
    textMatchCount: textMatchedElements.length
  };
}

function isVisible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function isDisabled(element) {
  if (!element) return false;
  return Boolean(element.disabled) || element.getAttribute("aria-disabled") === "true";
}

function normalizedElementText(element) {
  return String(element?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForTextMatch(value, caseSensitive) {
  return caseSensitive ? String(value) : String(value).toLowerCase();
}

function createTextFilter(action) {
  if (typeof action?.text !== "string" || action.text.length === 0) return null;
  const textMatch = ["contains", "exact", "regex"].includes(action.textMatch) ? action.textMatch : "contains";
  return {
    text: action.text,
    textMatch,
    caseSensitive: action.caseSensitive === true
  };
}

function elementMatchesTextFilter(element, filter) {
  const actual = normalizedElementText(element);
  if (filter.textMatch === "regex") {
    const flags = filter.caseSensitive ? "" : "i";
    return new RegExp(filter.text, flags).test(actual);
  }

  const normalizedActual = normalizeForTextMatch(actual, filter.caseSensitive);
  const normalizedExpected = normalizeForTextMatch(filter.text, filter.caseSensitive);
  return filter.textMatch === "exact" ? normalizedActual === normalizedExpected : normalizedActual.includes(normalizedExpected);
}

function dispatchInputEvents(element) {
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function propertyDescriptorInPrototypeChain(element, propertyName) {
  let prototype = Object.getPrototypeOf(element);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
    if (descriptor) return descriptor;
    prototype = Object.getPrototypeOf(prototype);
  }
  return null;
}

function setElementValue(element, value) {
  const descriptor = propertyDescriptorInPrototypeChain(element, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return "native-value-setter";
  }
  element.value = value;
  return "direct-value";
}

function selectElementContents(element) {
  const getSelection = globalThis.getSelection;
  if (typeof getSelection !== "function" || typeof document.createRange !== "function") return false;
  const selection = getSelection.call(globalThis);
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function setContentEditableText(element, value) {
  element.focus();
  const selected = selectElementContents(element);
  if (!selected) element.textContent = "";
  let inserted = false;
  try {
    inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, value);
  } catch {
    // Fall back to direct text content below when the browser disallows execCommand.
  }
  if (inserted && observedTextLength(element) === value.length) return "insertText";
  element.textContent = value;
  return "fallback-textContent";
}

function isFillableElement(element) {
  return Boolean(element?.isContentEditable) || "value" in element;
}

function firstFillableElement(selector) {
  const candidates = elementsForSelector(selector);
  const fillable = candidates.filter(isFillableElement);
  const usable = fillable.find((element) => isVisible(element) && !isDisabled(element));
  if (!usable) {
    throw new Error(
      `No visible enabled fillable element found for ${selector}; candidates=${candidates.length}; fillable=${fillable.length}; visible=${fillable.filter(isVisible).length}; enabled=${fillable.filter((element) => !isDisabled(element)).length}`
    );
  }
  return { element: usable, candidateCount: candidates.length };
}

function observedTextLength(element) {
  if (!element) return 0;
  if (!element.isContentEditable && "value" in element) return String(element.value ?? "").length;
  return String(element.innerText ?? element.textContent ?? "").length;
}

function fillElementDiagnostics(element) {
  return {
    tagName: String(element?.tagName || "").toLowerCase(),
    id: element?.id || "",
    role: element?.getAttribute?.("role") || "",
    type: element?.getAttribute?.("type") || "",
    contentEditable: Boolean(element?.isContentEditable)
  };
}

async function performAction(action) {
  if (!action || typeof action !== "object") throw new Error("Navoke browser action is required.");
  if (action.kind === "click") {
    const textFilter = createTextFilter(action);
    const { element, candidateCount, visibleCount, enabledCount, textMatchCount } = firstActionableElement(action.selector, textFilter);
    clickElement(element);
    return {
      ok: true,
      action: "click",
      selector: action.selector,
      candidateCount,
      visibleCount,
      enabledCount,
      ...(textFilter ? { text: textFilter.text, textMatch: textFilter.textMatch, caseSensitive: textFilter.caseSensitive, textMatchCount } : {})
    };
  }
  if (action.kind === "fill") {
    const value = String(action.value ?? "");
    const { element: fillTarget, candidateCount } = firstFillableElement(action.selector);
    if (fillTarget.isContentEditable) {
      const method = setContentEditableText(fillTarget, value);
      dispatchInputEvents(fillTarget);
      return {
        ok: true,
        action: "fill",
        selector: action.selector,
        candidateCount,
        chosen: fillElementDiagnostics(fillTarget),
        valueLength: value.length,
        observedLength: observedTextLength(fillTarget),
        method
      };
    }
    if ("value" in fillTarget) {
      fillTarget.focus();
      if (typeof fillTarget.select === "function") fillTarget.select();
      const method = setElementValue(fillTarget, value);
      dispatchInputEvents(fillTarget);
      return {
        ok: true,
        action: "fill",
        selector: action.selector,
        candidateCount,
        chosen: fillElementDiagnostics(fillTarget),
        valueLength: value.length,
        observedLength: observedTextLength(fillTarget),
        method
      };
    }
    throw new Error(`Element cannot be filled: ${action.selector}`);
  }
  if (action.kind === "submit") {
    const { element, candidateCount, visibleCount, enabledCount } = firstActionableElement(action.selector);
    if (element instanceof HTMLFormElement) {
      element.requestSubmit();
      return { ok: true, action: "submit", selector: action.selector, candidateCount, visibleCount, enabledCount };
    }
    const form = element.closest("form");
    if (form) {
      form.requestSubmit(element instanceof HTMLElement ? element : undefined);
      return { ok: true, action: "submit", selector: action.selector, candidateCount, visibleCount, enabledCount };
    }
    clickElement(element);
    return { ok: true, action: "submit", selector: action.selector, candidateCount, visibleCount, enabledCount };
  }
  if (action.kind === "select") {
    const element = firstElement(action.selector);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Element is not a select: ${action.selector}`);
    if (typeof action.index === "number") {
      element.selectedIndex = action.index;
    } else if (typeof action.label === "string") {
      const option = Array.from(element.options).find((candidate) => candidate.label === action.label || candidate.text === action.label);
      if (!option) throw new Error(`Select option label not found: ${action.label}`);
      element.value = option.value;
    } else if (typeof action.value === "string") {
      element.value = action.value;
    } else {
      throw new Error("Select action requires value, label, or index.");
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, action: "select", selector: action.selector, value: element.value };
  }
  if (action.kind === "attach-file") {
    const element = firstElement(action.selector);
    if (!(element instanceof HTMLInputElement) || element.type !== "file") {
      throw new Error(`Element is not a file input: ${action.selector}`);
    }
    const dataTransfer = new DataTransfer();
    for (const file of action.files || []) {
      const blob = await fetchStagedFileBlob(file);
      dataTransfer.items.add(new File([blob], file.name, { type: file.mimeType || blob.type || "application/octet-stream" }));
    }
    element.files = dataTransfer.files;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, action: "attach-file", selector: action.selector, count: dataTransfer.files.length };
  }
  throw new Error(`Unsupported Navoke browser action kind: ${action.kind || "unknown"}`);
}

function clickElement(element) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  try {
    element.focus?.({ preventScroll: true });
  } catch {
    element.focus?.();
  }
  if (typeof element.click === "function") {
    element.click();
    return;
  }
  element.dispatchEvent(
    typeof MouseEvent === "function"
      ? new MouseEvent("click", { bubbles: true, cancelable: true })
      : new Event("click", { bubbles: true, cancelable: true })
  );
}

async function fetchStagedFileBlob(file) {
  const relayed = await relayApiFetchBinary(file.url);
  if (relayed) {
    return new Blob([base64ToUint8Array(relayed.base64 || "")], {
      type: file.mimeType || relayed.mimeType || "application/octet-stream"
    });
  }

  const response = await fetch(apiUrl(file.url));
  if (!response.ok) throw new Error(`Could not fetch staged file ${file.name}: ${response.status}`);
  return response.blob();
}

async function relayApiFetchBinary(path) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "api-fetch-binary", path });
    if (result?.type === "api-fetch-binary-result") return result;
    if (result?.type === "api-fetch-binary-error") {
      throw new Error(result.error || `Could not fetch staged file: ${result.status || "unknown status"}`);
    }
  } catch {
    // Fall back to direct fetch for older background scripts or pages that permit localhost fetches.
  }
  return null;
}

function base64ToUint8Array(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function collectPageState() {
  const maxNodes = 900;
  let nodeCount = 0;

  function usefulAttributes(element) {
    const attributes = {};
    for (const attribute of Array.from(element.attributes || [])) {
      if (
        ["id", "class", "role", "name", "type", "placeholder", "href", "src", "aria-label"].includes(attribute.name) ||
        attribute.name.startsWith("data-")
      ) {
        attributes[attribute.name] = attribute.value;
      }
    }
    return attributes;
  }

  function elementText(element) {
    return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
  }

  function toDomNode(element, depth) {
    if (nodeCount >= maxNodes || depth > 7) return null;
    const tagName = element.tagName.toLowerCase();
    if (["script", "style", "noscript", "template", "svg"].includes(tagName)) return null;
    nodeCount += 1;
    const attrs = usefulAttributes(element);
    const children = Array.from(element.children || [])
      .slice(0, 40)
      .map((child) => toDomNode(child, depth + 1))
      .filter(Boolean);
    return {
      tagName,
      text: children.length === 0 ? elementText(element) : "",
      id: element.id || attrs.id || "",
      className: element.className ? String(element.className) : attrs.class || "",
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      name: element.getAttribute("name") || "",
      type: element.getAttribute("type") || "",
      placeholder: element.getAttribute("placeholder") || "",
      testId: element.getAttribute("data-testid") || element.getAttribute("data-test") || "",
      href: element instanceof HTMLAnchorElement ? element.href : "",
      src: element instanceof HTMLImageElement ? element.currentSrc || element.src : "",
      children
    };
  }

  function toInteractiveElement(element) {
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName.toLowerCase(),
      text: elementText(element),
      id: element.id || "",
      className: element.className ? String(element.className) : "",
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      name: element.getAttribute("name") || "",
      type: element.getAttribute("type") || "",
      placeholder: element.getAttribute("placeholder") || "",
      disabled: isDisabled(element),
      visible: isVisible(element),
      attributes: usefulAttributes(element),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  return {
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight },
    bodyText: document.body?.innerText || "",
    imageFingerprints: collectImageFingerprints("img"),
    dom: document.body ? toDomNode(document.body, 0) : null,
    interactiveElements: Array.from(document.querySelectorAll("a, button, input, textarea, select, summary, [role], [contenteditable], [onclick]"))
      .slice(0, 250)
      .map(toInteractiveElement)
  };
}

function collectImageFingerprints(selector) {
  return Array.from(document.querySelectorAll(selector || "img"))
    .filter((image) => image instanceof HTMLImageElement && image.naturalWidth > 0 && image.naturalHeight > 0 && Boolean(image.currentSrc || image.src))
    .map((image) => imageFingerprint(image));
}

function imageFingerprint(image) {
  return `${image.currentSrc || image.src}|${image.naturalWidth}x${image.naturalHeight}`;
}

function collectWaitState(condition, networkIdle) {
  const selector = condition?.kind === "element" ? condition.selector : undefined;
  const elements = selector ? elementsForSelector(selector) : [];
  const element = elements[0] || null;
  const imageSelector = condition?.kind === "image-count" && condition.selector ? condition.selector : "img";
  return {
    url: location.href,
    readyState: document.readyState,
    bodyText: document.body?.innerText || "",
    ...(selector
      ? {
          element: {
            selector,
            count: elements.length,
            visible: isVisible(element),
            disabled: isDisabled(element)
          }
        }
      : {}),
    imageFingerprints: collectImageFingerprints(imageSelector),
    ...(networkIdle === undefined ? {} : { networkIdle })
  };
}

function evaluateCondition(condition, state) {
  if (condition.kind === "element") {
    const count = state.element?.count || 0;
    const visible = Boolean(state.element?.visible);
    const disabled = Boolean(state.element?.disabled);
    const satisfied =
      condition.state === "hidden"
        ? count === 0 || !visible
        : condition.state === "visible"
          ? count > 0 && visible
          : condition.state === "enabled"
            ? count > 0 && visible && !disabled
            : count > 0 && disabled;
    return {
      satisfied,
      reason: satisfied ? `Element ${condition.selector} is ${condition.state}.` : `Element ${condition.selector} is not ${condition.state}.`,
      diagnostics: { selector: condition.selector, count, visible, disabled }
    };
  }
  if (condition.kind === "text") {
    const present = condition.text && state.bodyText.toLowerCase().includes(String(condition.text).toLowerCase());
    const satisfied = condition.state === "present" ? present : !present;
    return {
      satisfied,
      reason: satisfied ? `Text is ${condition.state}.` : `Text is not ${condition.state} yet.`,
      diagnostics: { text: condition.text, bodyTextLength: state.bodyText.length }
    };
  }
  if (condition.kind === "image-count") {
    const previous = new Set(condition.previousFingerprints || []);
    const current = state.imageFingerprints || [];
    const next = current.filter((fingerprint) => !previous.has(fingerprint));
    const satisfied = next.length >= Number(condition.minCount || 1);
    return {
      satisfied,
      reason: satisfied ? `Found ${next.length} new image fingerprint(s).` : `Found ${next.length} new image fingerprint(s).`,
      diagnostics: { currentCount: current.length, newCount: next.length, minCount: condition.minCount || 1 }
    };
  }
  if (condition.kind === "url") {
    const value = String(condition.value || "");
    const satisfied =
      condition.match === "equals" ? state.url === value : condition.match === "regex" ? new RegExp(value).test(state.url) : state.url.includes(value);
    return { satisfied, reason: satisfied ? "URL matched." : "URL did not match yet.", diagnostics: { url: state.url, value, match: condition.match } };
  }
  if (condition.kind === "document-ready") {
    const satisfied = state.readyState === "interactive" || state.readyState === "complete";
    return { satisfied, reason: satisfied ? "Document is ready." : "Document is not ready yet.", diagnostics: { readyState: state.readyState } };
  }
  if (condition.kind === "network-idle") {
    return {
      satisfied: state.networkIdle === true,
      reason: state.networkIdle === true ? "Network is idle." : "Network is not idle yet.",
      diagnostics: { networkIdle: state.networkIdle ?? null }
    };
  }
  throw new Error(`Unsupported Navoke browser wait condition: ${condition?.kind || "unknown"}`);
}

async function waitForCondition(condition) {
  if (!condition || typeof condition !== "object") throw new Error("Navoke browser wait condition is required.");
  const timeoutMs = Number(condition.timeoutMs || (condition.kind === "network-idle" ? 15000 : 30000));
  const startedAt = Date.now();
  let lastEvaluation = { satisfied: false, reason: "Wait has not evaluated yet.", diagnostics: {} };
  while (Date.now() - startedAt < timeoutMs) {
    if (condition.kind === "network-idle") {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    lastEvaluation = evaluateCondition(condition, collectWaitState(condition, condition.kind === "network-idle" ? true : undefined));
    if (lastEvaluation.satisfied) return { ...lastEvaluation, elapsedMs: Date.now() - startedAt };
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return {
    satisfied: false,
    reason: `Timed out: ${lastEvaluation.reason}`,
    diagnostics: { ...lastEvaluation.diagnostics, timeoutMs },
    elapsedMs: Date.now() - startedAt
  };
}

function textSnippet(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function imageSourceStableId(src) {
  if (!src) return "";
  try {
    const url = new URL(src, location.href);
    for (const key of ["id", "file", "file_id", "asset", "asset_id"]) {
      const value = url.searchParams.get(key);
      if (value) return `${key}:${value}`;
    }
    const pathParts = url.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1] || "";
    if (/^[A-Za-z0-9_-]{16,}$/.test(lastPart) && !/\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(lastPart)) {
      return `path:${lastPart}`;
    }
  } catch {
    return "";
  }
  return "";
}

function safeClosest(element, selector) {
  try {
    return typeof element?.closest === "function" ? element.closest(selector) : null;
  } catch {
    return null;
  }
}

function safeGetAttribute(element, name) {
  try {
    return element?.getAttribute?.(name) || "";
  } catch {
    return "";
  }
}

function usefulImageAttributes(element) {
  const attributes = {};
  for (const attribute of Array.from(element?.attributes || [])) {
    if (
      ["id", "class", "role", "name", "type", "href", "src", "alt", "title", "aria-label"].includes(attribute.name) ||
      attribute.name.startsWith("data-")
    ) {
      attributes[attribute.name] = String(attribute.value || "").slice(0, 240);
    }
  }
  return attributes;
}

function imageAncestorSummary(image) {
  let current = image.parentElement;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const attributes = usefulImageAttributes(current);
    const role = safeGetAttribute(current, "role");
    const ariaLabel = safeGetAttribute(current, "aria-label");
    const text = textSnippet(current.innerText || current.textContent || "", 260);
    if (role || ariaLabel || Object.keys(attributes).length > 0 || text) {
      return {
        tagName: String(current.tagName || "").toLowerCase(),
        role,
        ariaLabel,
        text,
        attributes
      };
    }
    current = current.parentElement;
  }
  return null;
}

function imageBounds(image) {
  const rect = image.getBoundingClientRect?.();
  if (!rect) return undefined;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function imageExtractionRecord(image, domIndex) {
  const src = image.currentSrc || image.src;
  return {
    src,
    alt: image.alt || "",
    width: image.naturalWidth,
    height: image.naturalHeight,
    fingerprint: imageFingerprint(image),
    stableSourceId: imageSourceStableId(src),
    domIndex,
    bounds: imageBounds(image),
    insideForm: Boolean(safeClosest(image, "form")),
    insideEditable: Boolean(safeClosest(image, "[contenteditable='true'], textarea, input")),
    insideButton: Boolean(safeClosest(image, "button, [role='button']")),
    insideLink: Boolean(safeClosest(image, "a[href]")),
    ancestor: imageAncestorSummary(image)
  };
}

async function extract(query) {
  if (!query || typeof query !== "object") throw new Error("Navoke browser extract query is required.");
  if (query.kind === "element-state") {
    const selector = requireSelector(query.selector);
    const elements = elementsForSelector(selector);
    const visibleElements = elements.filter(isVisible);
    const enabledElements = elements.filter((element) => !isDisabled(element));
    const first = visibleElements[0] || elements[0] || null;
    return {
      selector,
      count: elements.length,
      visibleCount: visibleElements.length,
      enabledCount: enabledElements.length,
      visible: isVisible(first),
      disabled: isDisabled(first),
      text: first?.textContent?.replace(/\s+/g, " ").trim() || ""
    };
  }
  if (query.kind === "text") {
    const root = query.selector ? firstElement(query.selector) : document.body;
    return { text: root?.innerText || root?.textContent || "" };
  }
  if (query.kind === "images") {
    const previous = new Set(query.excludeFingerprints || []);
    const previousStableSourceIds = new Set(query.excludeStableSourceIds || []);
    let images = Array.from(document.querySelectorAll(query.selector || "img"))
      .filter((image) => image instanceof HTMLImageElement)
      .filter((image) => image.naturalWidth >= (query.minWidth || 1) && image.naturalHeight >= (query.minHeight || 1))
      .filter((image) => Boolean(image.currentSrc || image.src))
      .map(imageExtractionRecord)
      .filter((image) => !previous.has(image.fingerprint))
      .filter((image) => !image.stableSourceId || !previousStableSourceIds.has(image.stableSourceId));
    if (query.latestFirst) images = images.reverse();
    if (Number.isInteger(query.maxImages) && query.maxImages > 0) images = images.slice(0, query.maxImages);
    if (!query.includeBase64) return { images };
    const withData = [];
    for (const image of images) {
      try {
        withData.push({ ...image, ...(await fetchImageData(image.src, Number(query.fetchTimeoutMs) || 10_000)) });
      } catch (error) {
        withData.push({ ...image, fetchError: error instanceof Error ? error.message : String(error) });
      }
    }
    return { images: withData };
  }
  throw new Error(`Unsupported Navoke browser extract query: ${query.kind || "unknown"}`);
}

async function fetchImageData(src, timeoutMs = 10_000) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(src, controller ? { signal: controller.signal } : undefined);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Could not fetch image: ${response.status}`);
  const blob = await response.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image blob."));
    reader.readAsDataURL(blob);
  });
  const commaIndex = dataUrl.indexOf(",");
  return {
    mimeType: blob.type || "image/png",
    base64: commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl
  };
}

void heartbeat();
setInterval(heartbeat, 2500);
setInterval(pollCommands, 500);
setInterval(pollFocusCommands, 800);

globalThis.__NavokeBrowserControllerTest = {
  performCommand,
  performAction,
  collectPageState,
  collectWaitState,
  evaluateCondition,
  waitForCondition,
  extract,
  isVisible,
  isDisabled,
  heartbeat,
  controllerHeartbeatForHeartbeat,
  lastControllerHeartbeat: () => lastControllerHeartbeat,
  routingTokenForHeartbeat
};
})();
