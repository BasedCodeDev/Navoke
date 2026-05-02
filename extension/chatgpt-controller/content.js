const DEFAULT_API_BASE = "http://127.0.0.1:39201";
const CHATGPT_EXTENSION_PROTOCOL_VERSION = 3;
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

function findFileInput(selectors) {
  return findElement(selectors.fileInput, ["input[type='file']"]);
}

function dispatchInputEvents(element) {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
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
  return Boolean(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true";
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
  while (Date.now() - started < 20_000) {
    const submit = findSubmitButton(selectors);
    if (isSubmitEnabled(submit)) return submit;
    await delay(500);
  }

  if (imageOnly) {
    throw new Error(
      "ChatGPT did not enable submit for an image-only subject. Add a short per-subject instruction and retry."
    );
  }
  throw new Error("Could not find an enabled ChatGPT submit button. Provide selectors.submitButton in the workflow.");
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

async function waitForNewOutputImages(task, beforeFingerprints, selectors, subject) {
  const started = Date.now();
  const timeoutMs = 45 * 60 * 1000;
  let lastCount = 0;
  let lastChangeAt = Date.now();

  while (Date.now() - started < timeoutMs) {
    assertNotHumanVerification();
    const newImages = collectImages(selectors.outputImage).filter((image) => !beforeFingerprints.has(imageFingerprint(image)));

    if (newImages.length > 0) {
      if (newImages.length !== lastCount) {
        lastCount = newImages.length;
        lastChangeAt = Date.now();
      }
      if (Date.now() - lastChangeAt > 3_000) {
        return newImages;
      }
    }

    await delay(1500);
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
    const beforeFingerprints = new Set(collectImages(selectors.outputImage).map(imageFingerprint));

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

    const images = await waitForNewOutputImages(task, beforeFingerprints, selectors, subject);
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
  if (!task) return;

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
