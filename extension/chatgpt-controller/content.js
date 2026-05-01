const DEFAULT_API_BASE = "http://127.0.0.1:39201";

let isRunningTask = false;
let clientId = `chrome-${Math.random().toString(36).slice(2)}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  document.execCommand("insertText", false, text);
  dispatchInputEvents(composer);
}

async function fetchTaskImage(task, apiBase) {
  const response = await fetch(`${apiBase}${task.image.url}`);
  if (!response.ok) throw new Error(`Could not fetch task image: ${response.statusText}`);
  const blob = await response.blob();
  return new File([blob], task.image.name, { type: blob.type || task.image.mimeType || "image/png" });
}

async function attachFile(task, file, selectors) {
  const input = findFileInput(selectors);
  if (!input) {
    throw new Error("Could not find ChatGPT file input. Provide selectors.fileInput or open a ChatGPT composer that exposes file upload.");
  }

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  dispatchInputEvents(input);
  await postTaskEvent(task.id, "extension.uploaded", "Attached input image");
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

async function waitForNewOutputImage(task, beforeFingerprints, selectors) {
  const started = Date.now();
  const timeoutMs = 45 * 60 * 1000;
  while (Date.now() - started < timeoutMs) {
    assertNotHumanVerification();
    const images = collectImages(selectors.outputImage);
    const candidate = images.reverse().find((image) => !beforeFingerprints.has(imageFingerprint(image)));
    if (candidate) return candidate;
    await delay(1500);
  }
  throw new Error("Timed out waiting for a new ChatGPT output image.");
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
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw error;
    return { mimeType: "image/png", base64: await blobToBase64(blob) };
  }
}

async function runChatGptImageTask(task) {
  const selectors = task.selectors || {};
  const apiBase = await getApiBase();
  assertNotHumanVerification();

  await postTaskEvent(task.id, "extension.started", "Preparing ChatGPT tab");
  const composer = findComposer(selectors);
  if (!composer) throw new Error("Could not find ChatGPT composer. Provide selectors.composer in the workflow.");

  const before = new Set(collectImages(selectors.outputImage).map(imageFingerprint));
  const file = await fetchTaskImage(task, apiBase);
  await attachFile(task, file, selectors);
  await delay(1000);

  await postTaskEvent(task.id, "extension.prompt", "Entering master prompt");
  setComposerText(composer, task.prompt);

  const submit = findSubmitButton(selectors);
  if (!submit) throw new Error("Could not find ChatGPT submit button. Provide selectors.submitButton in the workflow.");
  submit.click();

  await postTaskEvent(task.id, "extension.waiting", "Waiting for ChatGPT output image");
  const image = await waitForNewOutputImage(task, before, selectors);
  const output = await imageToOutput(image);

  await apiFetch(`/api/extension/tasks/${task.id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      outputs: [
        {
          name: `${task.image.name.replace(/\.[^.]+$/, "")}-chatgpt.png`,
          mimeType: output.mimeType,
          base64: output.base64
        }
      ],
      metadata: {
        url: location.href,
        title: document.title
      }
    })
  });
}

async function pollOnce() {
  const apiBase = await getApiBase();
  await apiFetch("/api/extension/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      id: clientId,
      url: location.href,
      title: document.title,
      status: isRunningTask ? "busy" : "ready"
    })
  });

  if (isRunningTask) return;
  const task = await apiFetch("/api/extension/tasks/next");
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
