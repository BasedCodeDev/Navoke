const DEFAULT_API_BASE = "http://127.0.0.1:39201";
const CHATGPT_EXTENSION_PROTOCOL_VERSION = 5;
const EXTENSION_VERSION = chrome.runtime?.getManifest?.().version || "unknown";
const CLIENT_ID_STORAGE_KEY = "workflowAutomationClientId";
const ROUTING_TOKEN_STORAGE_KEY = "workflowAutomationRoutingToken";
const ROUTING_TOKEN_PARAM = "workflow-automation-tab";

let isRunningTask = false;
let clientId = getOrCreateClientId();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readSessionValue(key) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in constrained browser modes.
  }
}

function getOrCreateClientId() {
  const existing = readSessionValue(CLIENT_ID_STORAGE_KEY);
  if (existing) return existing;
  const id = randomId("chrome");
  writeSessionValue(CLIENT_ID_STORAGE_KEY, id);
  return id;
}

function normalizeRoutingToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readRoutingTokenFromUrl() {
  const searchToken = normalizeRoutingToken(new URLSearchParams(location.search).get(ROUTING_TOKEN_PARAM));
  if (searchToken) return searchToken;
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  return normalizeRoutingToken(new URLSearchParams(hash).get(ROUTING_TOKEN_PARAM));
}

function removeRoutingTokenFromUrl() {
  const url = new URL(location.href);
  const search = new URLSearchParams(url.search);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  let changed = false;

  if (search.has(ROUTING_TOKEN_PARAM)) {
    search.delete(ROUTING_TOKEN_PARAM);
    changed = true;
  }
  if (hash.has(ROUTING_TOKEN_PARAM)) {
    hash.delete(ROUTING_TOKEN_PARAM);
    changed = true;
  }
  if (!changed) return;

  const searchText = search.toString();
  const hashText = hash.toString();
  history.replaceState(
    history.state,
    "",
    `${url.pathname}${searchText ? `?${searchText}` : ""}${hashText ? `#${hashText}` : ""}`
  );
}

function getRoutingToken() {
  const fromUrl = readRoutingTokenFromUrl();
  if (fromUrl) {
    writeSessionValue(ROUTING_TOKEN_STORAGE_KEY, fromUrl);
    removeRoutingTokenFromUrl();
    return fromUrl;
  }
  return readSessionValue(ROUTING_TOKEN_STORAGE_KEY);
}

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function getApiBase() {
  const values = await getStorage(["apiBaseUrl"]);
  return (values.apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function apiFetch(path, options = {}) {
  const apiBase = await getApiBase();
  const response = await fetch(`${apiBase}${path}`, {
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
    throw new Error(body?.error || response.statusText);
  }
  return body;
}

async function postTaskEvent(taskId, type, message, data) {
  await apiFetch(`/api/extension/tasks/${taskId}/events`, {
    method: "POST",
    body: JSON.stringify({ type, message, data })
  }).catch(() => undefined);
}

function getBodyText() {
  return document.body?.innerText || "";
}

function assertNotHumanVerification() {
  if (
    /verify (you are|that you are|you're) human|confirm (you are|that you are|you're) human|checking.*browser|security of your connection|unusual traffic/i.test(
      getBodyText()
    )
  ) {
    throw new Error("ChatGPT is showing human verification. Complete it manually in this normal Chrome tab, then retry the workflow.");
  }
}

function findElement(configuredSelector, fallbacks) {
  const selectors = [configuredSelector, ...fallbacks].filter(Boolean);
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function findComposer(selectors) {
  return findElement(selectors.composer, [
    "#prompt-textarea",
    "textarea[data-id='root']",
    "textarea",
    "[contenteditable='true']"
  ]);
}

function findSubmitButton(selectors) {
  return findElement(selectors.submitButton, [
    "button[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send message']",
    "form button[type='submit']"
  ]);
}

function findVisibleElementBySelectors(selectors) {
  for (const selector of selectors.filter(Boolean)) {
    const elements = Array.from(document.querySelectorAll(selector));
    const visible = elements.find((element) => isElementVisible(element));
    if (visible) return visible;
  }
  return null;
}

function getButtonLabel(button) {
  return `${button?.getAttribute?.("aria-label") || ""} ${button?.getAttribute?.("title") || ""} ${button?.textContent || ""}`
    .replace(/\s+/g, " ")
    .trim();
}

function isChatGptActiveStopButtonLabel(label) {
  const normalized = String(label || "").trim();
  if (!normalized || /\bstopped\b/i.test(normalized)) return false;
  return (
    /^(stop|cancel)$/i.test(normalized) ||
    /^stop (generating|generation|streaming|response|thinking|request)$/i.test(normalized) ||
    /^cancel (generating|generation|streaming|response|request)$/i.test(normalized)
  );
}

function findStopButton(selectors) {
  const normalizedSelectors = selectors || {};
  const configured = findElement(normalizedSelectors.stopButton, []);
  if (configured && isElementVisible(configured)) return configured;

  const knownStopButton = findVisibleElementBySelectors([
    "button[data-testid='stop-button']",
    "button[data-testid='composer-stop-button']",
    "button[aria-label='Stop']",
    "button[aria-label='Stop generating']",
    "button[aria-label='Stop generation']",
    "button[aria-label='Stop streaming']",
    "button[aria-label='Stop response']",
    "button[aria-label='Stop thinking']",
    "button[aria-label='Cancel generation']",
    "button[aria-label='Cancel response']",
    "button[aria-label='Cancel request']"
  ]);
  if (knownStopButton) return knownStopButton;

  const buttons = Array.from(document.querySelectorAll("button"));
  return (
    buttons.find((button) => {
      return isElementVisible(button) && isChatGptActiveStopButtonLabel(getButtonLabel(button));
    }) || null
  );
}

function findFileInput(selectors) {
  return findElement(selectors.fileInput, ["input[type='file']"]);
}

function dispatchInputEvents(element) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function isElementVisible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function setComposerText(composer, text) {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    composer.value = text;
    dispatchInputEvents(composer);
    return;
  }
  composer.textContent = "";
  if (text) {
    document.execCommand("insertText", false, text);
  }
  dispatchInputEvents(composer);
}

function isSubmitEnabled(button) {
  return Boolean(button) && isElementVisible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true";
}

function collectVisibleButtonLabels() {
  return Array.from(document.querySelectorAll("button"))
    .filter((button) => isElementVisible(button))
    .slice(0, 16)
    .map((button) => getButtonLabel(button))
    .filter(Boolean);
}

function collectVisibleImageCount() {
  return Array.from(document.images).filter(
    (image) => image.naturalWidth > 0 && image.naturalHeight > 0 && isElementVisible(image) && Boolean(image.currentSrc || image.src)
  ).length;
}

function collectChatGptSubmitReadyState(selectors) {
  const normalizedSelectors = selectors || {};
  const composer = findComposer(normalizedSelectors);
  const submit = findSubmitButton(normalizedSelectors);
  const stopButton = findStopButton(normalizedSelectors);
  const fileInput = findFileInput(normalizedSelectors);

  return {
    composerFound: Boolean(composer),
    composerVisible: isElementVisible(composer),
    submitFound: Boolean(submit),
    submitVisible: isElementVisible(submit),
    submitEnabled: isSubmitEnabled(submit),
    stopButtonVisible: Boolean(stopButton),
    stopButtonLabel: stopButton ? getButtonLabel(stopButton) : null,
    fileInputFound: Boolean(fileInput),
    visibleButtons: collectVisibleButtonLabels(),
    imageCount: collectVisibleImageCount()
  };
}

function evaluateChatGptSubmitReadyState(state) {
  if (!state) {
    return {
      satisfied: false,
      reason: "ChatGPT submit state was not captured.",
      diagnostics: {}
    };
  }

  const satisfied =
    state.composerFound &&
    state.composerVisible &&
    state.submitFound &&
    state.submitVisible &&
    state.submitEnabled &&
    !state.stopButtonVisible;
  const reason = satisfied
    ? "ChatGPT submit button is ready."
    : state.stopButtonVisible
      ? "ChatGPT generation is still active; stop button is visible."
      : !state.composerFound
        ? "ChatGPT composer was not found."
        : !state.submitFound
          ? "ChatGPT submit button was not found."
          : !state.submitVisible
            ? "ChatGPT submit button is not visible."
            : !state.submitEnabled
              ? "ChatGPT submit button is still disabled, likely while uploads or processing finish."
              : "ChatGPT submit button is not ready.";

  return {
    satisfied,
    reason,
    diagnostics: state
  };
}

function protocolError(message) {
  return new Error(
    `${message} Reload the unpacked Browser Workflow Automation Chrome extension and refresh every open ChatGPT tab.`
  );
}

function validateImagePayload(image, group, index) {
  if (!image || typeof image !== "object") {
    throw protocolError(`Invalid ChatGPT extension task payload: missing ${group} image at index ${index}.`);
  }
  if (typeof image.url !== "string" || image.url.length === 0) {
    throw protocolError(`Invalid ChatGPT extension task payload: ${group} image ${index} is missing url.`);
  }
  if (typeof image.name !== "string" || image.name.length === 0) {
    throw protocolError(`Invalid ChatGPT extension task payload: ${group} image ${index} is missing name.`);
  }
  return image;
}

function validateImageList(images, group) {
  if (!Array.isArray(images)) {
    throw protocolError(`Invalid ChatGPT extension task payload: ${group}Images must be an array.`);
  }
  return images.map((image, index) => validateImagePayload(image, group, index));
}

function validateTaskPayload(task) {
  if (!task || typeof task !== "object") {
    throw protocolError("Invalid ChatGPT extension task payload: task is missing.");
  }
  if (task.protocolVersion !== CHATGPT_EXTENSION_PROTOCOL_VERSION) {
    throw protocolError(
      `ChatGPT extension protocol mismatch. App sent protocol ${task.protocolVersion || "unknown"}; extension expects ${CHATGPT_EXTENSION_PROTOCOL_VERSION}.`
    );
  }
  if (task.kind !== "chatgpt-image-transform") {
    throw protocolError(`Unsupported ChatGPT extension task kind: ${task.kind || "unknown"}.`);
  }
  if (typeof task.id !== "string" || task.id.length === 0) {
    throw protocolError("Invalid ChatGPT extension task payload: task id is missing.");
  }
  if (typeof task.masterPrompt !== "string" || task.masterPrompt.length === 0) {
    throw protocolError("Invalid ChatGPT extension task payload: masterPrompt is missing.");
  }
  return {
    ...task,
    referenceImages: validateImageList(task.referenceImages, "reference"),
    subjectImages: validateImageList(task.subjectImages, "subject"),
    selectors: task.selectors && typeof task.selectors === "object" ? task.selectors : {},
    subjectInstruction: typeof task.subjectInstruction === "string" ? task.subjectInstruction : ""
  };
}

async function waitForSubmitButton(task, selectors, imageOnly) {
  const started = Date.now();
  const timeoutMs = 180_000;
  let reportedSlowWait = false;
  let lastEvaluation = {
    satisfied: false,
    reason: "Submit readiness has not been evaluated yet.",
    diagnostics: {}
  };

  while (Date.now() - started < timeoutMs) {
    assertNotHumanVerification();
    const state = collectChatGptSubmitReadyState(selectors);
    lastEvaluation = evaluateChatGptSubmitReadyState(state);
    if (lastEvaluation.satisfied) {
      const submit = findSubmitButton(selectors);
      if (submit) return submit;
    }

    if (!reportedSlowWait && Date.now() - started > 20_000) {
      reportedSlowWait = true;
      await postTaskEvent(task.id, "extension.submit.waiting", "Waiting for ChatGPT submit button to become ready", {
        imageOnly,
        reason: lastEvaluation.reason,
        diagnostics: lastEvaluation.diagnostics
      });
    }

    await delay(state.stopButtonVisible ? 750 : 500);
  }

  await postTaskEvent(task.id, "extension.submit.timeout", "Timed out waiting for ChatGPT submit button", {
    imageOnly,
    timeoutMs,
    reason: lastEvaluation.reason,
    diagnostics: lastEvaluation.diagnostics
  });

  if (imageOnly) {
    throw new Error(
      `Timed out waiting for ChatGPT to enable submit for an image-only subject. ${lastEvaluation.reason} Add a short per-subject instruction and retry.`
    );
  }

  throw new Error(`Timed out waiting for ChatGPT submit button to become ready. ${lastEvaluation.reason}`);
}

async function fetchTaskImage(image, apiBase) {
  validateImagePayload(image, "task", image?.index ?? 0);
  const response = await fetch(`${apiBase}${image.url}`);
  if (!response.ok) throw new Error(`Could not fetch task image: ${response.statusText}`);
  const blob = await response.blob();
  return new File([blob], image.name, { type: blob.type || image.mimeType || "image/png" });
}

async function attachImages(task, images, selectors, label) {
  if (!Array.isArray(images)) {
    throw protocolError(`Invalid ChatGPT extension task payload: ${label} images must be an array.`);
  }
  if (images.length === 0) return;
  const input = findFileInput(selectors);
  if (!input) {
    throw new Error("Could not find ChatGPT file input. Provide selectors.fileInput or open a ChatGPT composer that exposes file upload.");
  }

  const apiBase = await getApiBase();
  const dataTransfer = new DataTransfer();
  for (const image of images) {
    dataTransfer.items.add(await fetchTaskImage(image, apiBase));
  }
  input.files = dataTransfer.files;
  dispatchInputEvents(input);
  await postTaskEvent(task.id, "extension.uploaded", `Attached ${images.length} ${label} image(s)`);
}

async function attachWorkflowLabFiles(action) {
  const selector = String(action.selector || "");
  const files = Array.isArray(action.files) ? action.files : [];
  if (!selector) throw new Error("Workflow Lab attach-file action requires a file input selector.");
  if (files.length === 0) throw new Error("Workflow Lab attach-file action requires at least one staged file.");

  const input = document.querySelector(selector);
  if (!(input instanceof HTMLInputElement) || input.type !== "file") {
    throw new Error(`Workflow Lab attach-file selector did not resolve to a file input: ${selector}`);
  }

  const apiBase = await getApiBase();
  const dataTransfer = new DataTransfer();
  for (const [index, file] of files.entries()) {
    dataTransfer.items.add(await fetchTaskImage(validateImagePayload(file, "lab", index), apiBase));
  }
  input.files = dataTransfer.files;
  dispatchInputEvents(input);

  return {
    ok: true,
    attachedCount: files.length,
    fileNames: files.map((file) => file.name)
  };
}

function imageFingerprint(image) {
  return `${image.currentSrc || image.src}|${image.naturalWidth}x${image.naturalHeight}`;
}

function collectImages(selector) {
  const configured = selector ? Array.from(document.querySelectorAll(selector)) : [];
  const fallback = Array.from(document.querySelectorAll("main img, article img"));
  return [...configured, ...fallback].filter(
    (image, index, all) =>
      image instanceof HTMLImageElement &&
      all.indexOf(image) === index &&
      image.naturalWidth >= 64 &&
      image.naturalHeight >= 64 &&
      (image.currentSrc || image.src)
  );
}

function collectResponseState(selectors) {
  const assistantElements = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
  const articleElements = Array.from(document.querySelectorAll("main article"));
  return {
    assistantCount: assistantElements.length,
    assistantText: assistantElements.map((element) => element.textContent || "").join("\n").trim(),
    articleCount: articleElements.length,
    bodyText: getBodyText(),
    imageFingerprints: new Set(collectImages(selectors.outputImage).map(imageFingerprint))
  };
}

async function waitForAnyResponse(task, beforeState, selectors) {
  const started = Date.now();
  while (Date.now() - started < 20 * 60 * 1000) {
    assertNotHumanVerification();
    const state = collectResponseState(selectors);
    const hasNewImage = [...state.imageFingerprints].some((fingerprint) => !beforeState.imageFingerprints.has(fingerprint));
    const hasAssistantChange =
      state.assistantCount > beforeState.assistantCount ||
      (state.assistantText.length > 0 && state.assistantText !== beforeState.assistantText);
    const hasFallbackChange =
      Date.now() - started > 5_000 && state.assistantCount === 0 && state.articleCount > beforeState.articleCount;

    if (hasAssistantChange || hasNewImage || hasFallbackChange) return;
    await delay(1000);
  }
  throw new Error("Timed out waiting for ChatGPT to respond to the setup prompt.");
}

function hasResponseChanged(beforeState, state) {
  const hasNewImage = [...state.imageFingerprints].some((fingerprint) => !beforeState.imageFingerprints.has(fingerprint));
  const hasAssistantChange =
    state.assistantCount > beforeState.assistantCount ||
    (state.assistantText.length > 0 && state.assistantText !== beforeState.assistantText);
  const hasArticleChange = state.articleCount > beforeState.articleCount;
  return { hasNewImage, hasAssistantChange, hasArticleChange };
}

async function waitForGenerationStarted(task, beforeState, selectors, subject) {
  const started = Date.now();
  const timeoutMs = 60 * 1000;

  while (Date.now() - started < timeoutMs) {
    assertNotHumanVerification();
    if (findStopButton(selectors)) {
      return { reason: "stop-button-visible" };
    }

    const state = collectResponseState(selectors);
    const changed = hasResponseChanged(beforeState, state);
    if (changed.hasNewImage) return { reason: "new-image-detected" };
    if (changed.hasAssistantChange) return { reason: "assistant-response-changed" };
    if (changed.hasArticleChange && Date.now() - started > 1500) return { reason: "article-count-changed" };

    const submit = findSubmitButton(selectors);
    if (Date.now() - started > 1500 && submit && !isSubmitEnabled(submit)) {
      return { reason: "submit-button-disabled" };
    }

    await delay(300);
  }

  throw new Error(`Timed out waiting for ChatGPT generation to start for ${subject.name}.`);
}

async function waitForCompletedOutputImages(task, beforeState, selectors, subject) {
  const started = Date.now();
  const timeoutMs = 45 * 60 * 1000;
  let lastCount = 0;
  let lastFingerprintKey = "";
  let lastChangeAt = Date.now();

  while (Date.now() - started < timeoutMs) {
    assertNotHumanVerification();
    const stopVisible = Boolean(findStopButton(selectors));
    const newImages = collectImages(selectors.outputImage).filter((image) => !beforeState.imageFingerprints.has(imageFingerprint(image)));

    if (newImages.length > 0) {
      const fingerprintKey = newImages.map(imageFingerprint).sort().join("\n");
      if (newImages.length !== lastCount || fingerprintKey !== lastFingerprintKey) {
        lastCount = newImages.length;
        lastFingerprintKey = fingerprintKey;
        lastChangeAt = Date.now();
      }
      if (!stopVisible && Date.now() - lastChangeAt > 3_000) {
        return newImages;
      }
    }

    await delay(stopVisible ? 750 : 1250);
  }
  throw new Error(`Timed out waiting for a new ChatGPT output image for ${subject.name}.`);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Could not read image blob"));
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.readAsDataURL(blob);
  });
}

async function imageToOutput(image) {
  const src = image.currentSrc || image.src;
  if (src.startsWith("data:")) {
    const [header, base64] = src.split(",", 2);
    const mimeType = /data:([^;]+)/.exec(header)?.[1] || "image/png";
    return { mimeType, base64 };
  }

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(response.statusText);
    const blob = await response.blob();
    return { mimeType: blob.type || "image/png", base64: await blobToBase64(blob) };
  } catch (error) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw error;
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw error;
    return { mimeType: "image/png", base64: await blobToBase64(blob) };
  }
}

function collectWorkflowLabPageState() {
  const maxNodes = 900;
  let nodeCount = 0;

  function usefulAttributes(element) {
    const attributes = {};
    for (const attribute of Array.from(element.attributes || [])) {
      if (
        attribute.name === "id" ||
        attribute.name === "class" ||
        attribute.name === "role" ||
        attribute.name === "name" ||
        attribute.name === "type" ||
        attribute.name === "placeholder" ||
        attribute.name === "href" ||
        attribute.name === "src" ||
        attribute.name === "aria-label" ||
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
    if (!element || nodeCount >= maxNodes || depth > 7) return null;
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

  function isInteractive(element) {
    const tagName = element.tagName.toLowerCase();
    return (
      ["button", "input", "textarea", "select", "a", "summary"].includes(tagName) ||
      element.hasAttribute("role") ||
      element.hasAttribute("contenteditable") ||
      element.hasAttribute("onclick")
    );
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
      disabled: Boolean("disabled" in element && element.disabled) || element.getAttribute("aria-disabled") === "true",
      visible: isElementVisible(element),
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
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyText: document.body?.innerText || "",
    imageFingerprints: Array.from(document.images)
      .filter((image) => image.naturalWidth > 0 && image.naturalHeight > 0 && (image.currentSrc || image.src))
      .map(imageFingerprint),
    dom: document.body ? toDomNode(document.body, 0) : null,
    interactiveElements: Array.from(document.querySelectorAll("a, button, input, textarea, select, summary, [role], [contenteditable], [onclick]"))
      .filter(isInteractive)
      .slice(0, 250)
      .map(toInteractiveElement)
  };
}

function collectWorkflowLabWaitState(condition) {
  function isDisabled(element) {
    return Boolean(element && "disabled" in element && element.disabled) || element?.getAttribute("aria-disabled") === "true";
  }

  const selector = condition.kind === "element" ? condition.selector : "";
  const element = selector ? document.querySelector(selector) : null;
  const imageSelector = condition.kind === "image-count" && condition.selector ? condition.selector : "img";
  const images = Array.from(document.querySelectorAll(imageSelector)).filter(
    (image) =>
      image instanceof HTMLImageElement &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0 &&
      Boolean(image.currentSrc || image.src)
  );
  const stopButton = findStopButton({ stopButton: condition.kind === "stop-button" ? condition.selector : undefined });
  const chatGptSubmit = condition.kind === "chatgpt-submit-ready" ? collectChatGptSubmitReadyState(condition.selectors || {}) : undefined;

  return {
    bodyText: document.body?.innerText || "",
    ...(selector
      ? {
          element: {
            selector,
            count: document.querySelectorAll(selector).length,
            visible: isElementVisible(element),
            disabled: isDisabled(element)
          }
        }
      : {}),
    imageFingerprints: images.map(imageFingerprint),
    stopButtonVisible: Boolean(stopButton),
    ...(chatGptSubmit ? { chatGptSubmit } : {}),
    networkIdle: document.readyState === "complete"
  };
}

function evaluateWorkflowLabWaitCondition(condition, state) {
  if (condition.kind === "element") {
    const element = state.element || { count: 0, visible: false, disabled: false };
    const satisfied =
      condition.state === "hidden"
        ? element.count === 0 || !element.visible
        : condition.state === "visible"
          ? element.count > 0 && element.visible
          : condition.state === "enabled"
            ? element.count > 0 && element.visible && !element.disabled
            : element.count > 0 && element.disabled;
    return {
      satisfied,
      reason: satisfied ? `Element ${condition.selector} is ${condition.state}.` : `Element ${condition.selector} is not ${condition.state}.`,
      diagnostics: element
    };
  }

  if (condition.kind === "text") {
    const present = (state.bodyText || "").toLowerCase().includes(String(condition.text || "").toLowerCase());
    const satisfied = condition.state === "present" ? present : !present;
    return {
      satisfied,
      reason: satisfied ? `Text is ${condition.state}.` : `Text is not ${condition.state} yet.`,
      diagnostics: { bodyTextLength: state.bodyText.length, text: condition.text }
    };
  }

  if (condition.kind === "image-count") {
    const previous = new Set(condition.previousFingerprints || []);
    const newFingerprints = state.imageFingerprints.filter((fingerprint) => !previous.has(fingerprint));
    const satisfied = newFingerprints.length >= Number(condition.minCount || 1);
    return {
      satisfied,
      reason: satisfied
        ? `Found ${newFingerprints.length} new image fingerprint(s).`
        : `Found ${newFingerprints.length} new image fingerprint(s); waiting for ${condition.minCount || 1}.`,
      diagnostics: { currentCount: state.imageFingerprints.length, newCount: newFingerprints.length }
    };
  }

  if (condition.kind === "stop-button") {
    const satisfied = condition.state === "visible" ? state.stopButtonVisible : !state.stopButtonVisible;
    return {
      satisfied,
      reason: satisfied
        ? `Stop button is ${condition.state}.`
        : `Stop button is not ${condition.state} yet.`,
      diagnostics: { stopButtonVisible: state.stopButtonVisible }
    };
  }

  if (condition.kind === "chatgpt-submit-ready") {
    return evaluateChatGptSubmitReadyState(state.chatGptSubmit);
  }

  return {
    satisfied: state.networkIdle === true,
    reason: state.networkIdle === true ? "Document is ready." : "Document is not ready yet.",
    diagnostics: { readyState: document.readyState }
  };
}

function workflowLabWaitTimeout(condition) {
  return Number(condition.timeoutMs || (condition.kind === "network-idle" ? 15000 : condition.kind === "chatgpt-submit-ready" ? 120000 : 30000));
}

async function waitForWorkflowLabCondition(condition) {
  const started = Date.now();
  const timeoutMs = workflowLabWaitTimeout(condition);
  let lastEvaluation = { satisfied: false, reason: "Wait has not evaluated yet.", diagnostics: {} };

  while (Date.now() - started < timeoutMs) {
    const state = collectWorkflowLabWaitState(condition);
    lastEvaluation = evaluateWorkflowLabWaitCondition(condition, state);
    if (lastEvaluation.satisfied) return lastEvaluation;
    await delay(350);
  }

  return {
    satisfied: false,
    reason: `Timed out: ${lastEvaluation.reason}`,
    diagnostics: { ...lastEvaluation.diagnostics, timeoutMs }
  };
}

async function runWorkflowLabAction(action) {
  if (!action || typeof action !== "object") throw new Error("Invalid Workflow Lab action.");
  if (action.kind === "attach-file") {
    return attachWorkflowLabFiles(action);
  }
  const selector = String(action.selector || "");
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Workflow Lab could not find selector: ${selector}`);

  if (action.kind === "fill") {
    setComposerText(element, String(action.value || ""));
    return { ok: true };
  }

  if (action.kind === "submit" && element instanceof HTMLFormElement) {
    element.requestSubmit();
    return { ok: true };
  }

  element.click();
  return { ok: true };
}

async function runWorkflowLabCommand(payload) {
  if (!payload || payload.protocolVersion !== CHATGPT_EXTENSION_PROTOCOL_VERSION) {
    throw protocolError("Workflow Lab extension protocol mismatch.");
  }
  const command = payload.command || {};
  if (command.kind === "inspect") return collectWorkflowLabPageState();
  if (command.kind === "action") return runWorkflowLabAction(command.action);
  if (command.kind === "wait") return waitForWorkflowLabCondition(command.condition || {});
  throw new Error(`Unsupported Workflow Lab command: ${command.kind || "unknown"}`);
}

async function submitComposer(task, selectors, imageOnly) {
  const submit = await waitForSubmitButton(task, selectors, imageOnly);
  submit.click();
}

async function runChatGptImageTask(task) {
  task = validateTaskPayload(task);
  const selectors = task.selectors || {};
  assertNotHumanVerification();

  await postTaskEvent(task.id, "extension.setup", "Preparing ChatGPT setup prompt", {
    referenceCount: task.referenceImages.length,
    subjectCount: task.subjectImages.length
  });

  let composer = findComposer(selectors);
  if (!composer) throw new Error("Could not find ChatGPT composer. Provide selectors.composer in the workflow.");

  await attachImages(task, task.referenceImages || [], selectors, "reference");
  await delay(1200);
  setComposerText(composer, task.masterPrompt);
  const setupBefore = collectResponseState(selectors);
  await postTaskEvent(task.id, "extension.setup.submit", "Submitting master prompt");
  await submitComposer(task, selectors, false);
  await postTaskEvent(task.id, "extension.setup.waiting", "Waiting for ChatGPT setup response");
  await waitForAnyResponse(task, setupBefore, selectors);

  const outputs = [];
  const subjectInstruction = (task.subjectInstruction || "").trim();

  for (const subject of task.subjectImages) {
    assertNotHumanVerification();
    await postTaskEvent(task.id, "extension.subject.started", `Submitting subject ${subject.index + 1} of ${task.subjectImages.length}`, {
      subjectIndex: subject.index,
      subjectName: subject.name
    });

    composer = findComposer(selectors);
    if (!composer) throw new Error("Could not find ChatGPT composer for subject submission.");
    await attachImages(task, [subject], selectors, "subject");
    await delay(1200);
    const subjectBefore = collectResponseState(selectors);

    if (subjectInstruction) {
      setComposerText(composer, subjectInstruction);
    } else {
      setComposerText(composer, "");
    }

    await submitComposer(task, selectors, subjectInstruction.length === 0);
    await postTaskEvent(task.id, "extension.subject.waiting", `Waiting for output image for ${subject.name}`, {
      subjectIndex: subject.index,
      subjectName: subject.name
    });

    const generationStart = await waitForGenerationStarted(task, subjectBefore, selectors, subject);
    await postTaskEvent(task.id, "extension.subject.generation_started", `Generation started for ${subject.name}`, {
      subjectIndex: subject.index,
      subjectName: subject.name,
      reason: generationStart.reason
    });

    const images = await waitForCompletedOutputImages(task, subjectBefore, selectors, subject);
    for (const [outputIndex, image] of images.entries()) {
      const output = await imageToOutput(image);
      outputs.push({
        subjectIndex: subject.index,
        subjectName: subject.name,
        name: `${subject.name.replace(/\.[^.]+$/, "")}-chatgpt-${outputIndex + 1}.png`,
        mimeType: output.mimeType,
        base64: output.base64,
        metadata: {
          url: image.currentSrc || image.src,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight
        }
      });
    }
    await postTaskEvent(task.id, "extension.subject.completed", `Captured ${images.length} output image(s) for ${subject.name}`, {
      subjectIndex: subject.index,
      outputCount: images.length
    });
  }

  await apiFetch(`/api/extension/tasks/${task.id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      outputs,
      metadata: {
        url: location.href,
        title: document.title
      }
    })
  });
}

async function pollOnce() {
  await apiFetch("/api/extension/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      id: clientId,
      url: location.href,
      title: document.title,
      status: isRunningTask ? "busy" : "ready",
      protocolVersion: CHATGPT_EXTENSION_PROTOCOL_VERSION,
      extensionVersion: EXTENSION_VERSION,
      routingToken: getRoutingToken()
    })
  });

  if (isRunningTask) return;
  const task = await apiFetch(`/api/extension/tasks/next?clientId=${encodeURIComponent(clientId)}`);
  if (!task) {
    const labCommand = await apiFetch(`/api/extension/lab/commands/next?clientId=${encodeURIComponent(clientId)}`);
    if (!labCommand) return;

    isRunningTask = true;
    try {
      const result = await runWorkflowLabCommand(labCommand);
      await apiFetch(`/api/extension/lab/commands/${labCommand.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ result })
      });
    } catch (error) {
      await apiFetch(`/api/extension/lab/commands/${labCommand.id}/fail`, {
        method: "POST",
        body: JSON.stringify({
          message: error instanceof Error ? error.message : String(error)
        })
      }).catch(() => undefined);
    } finally {
      isRunningTask = false;
    }
    return;
  }

  isRunningTask = true;
  try {
    await runChatGptImageTask(task);
  } catch (error) {
    await apiFetch(`/api/extension/tasks/${task.id}/fail`, {
      method: "POST",
      body: JSON.stringify({
        message: error instanceof Error ? error.message : String(error)
      })
    }).catch(() => undefined);
  } finally {
    isRunningTask = false;
  }
}

async function pollLoop() {
  while (true) {
    try {
      await pollOnce();
    } catch {
      // The Electron app may not be running yet.
    }
    await delay(2000);
  }
}

void pollLoop();
