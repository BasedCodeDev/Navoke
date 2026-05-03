import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "playwright";
import { launchPersistentProfile } from "../automation/browserHarness";
import type { ExtensionBridge } from "../extension/extensionBridge";
import type { RuntimePaths } from "../runtime/types";
import { ensureDir } from "../runtime/paths";
import { inferMimeType, safeBaseName, writeJson } from "../utils/files";
import { sleep } from "../utils/sleep";
import {
  buildInspectionModel,
  type LabInspectionModel,
  type LabRawDomNode,
  type LabRawInteractiveElement,
  type LabRawPageState
} from "./pageInspection";
import {
  defaultWaitTimeoutMs,
  evaluateWaitCondition,
  waitConditionLabel,
  type LabWaitCondition,
  type LabWaitEvaluation,
  type LabWaitPageState
} from "./waitConditions";

export type WorkflowLabSessionMode = "playwright" | "extension";
export type WorkflowLabProfileWorkflowId = "workflow-lab" | "hunyuan";

export type WorkflowLabAction =
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "submit"; selector: string }
  | { kind: "attach-file"; selector: string; filePaths: string[] };

interface WorkflowLabStagedFile {
  id: string;
  sourcePath: string;
  name: string;
  mimeType: string;
  url: string;
}

export interface WorkflowLabSessionCreateInput {
  mode: WorkflowLabSessionMode;
  targetUrl?: string;
  profileWorkflowId?: string;
  profileName?: string;
  clientId?: string;
}

export interface WorkflowLabArtifactRef {
  name: string;
  path: string;
  mimeType: string;
  size: number;
}

export interface WorkflowLabActionLogEntry {
  id: string;
  type: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

export interface WorkflowLabSessionSummary {
  id: string;
  mode: WorkflowLabSessionMode;
  targetUrl: string;
  profileWorkflowId?: WorkflowLabProfileWorkflowId;
  profileName?: string;
  clientId?: string;
  status: "ready" | "closed";
  title?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
  artifacts: WorkflowLabArtifactRef[];
  actionLog: WorkflowLabActionLogEntry[];
}

export interface WorkflowLabInspectionResult {
  session: WorkflowLabSessionSummary;
  inspection: LabInspectionModel;
  screenshotBase64?: string;
  screenshotMimeType?: string;
  artifacts: WorkflowLabArtifactRef[];
}

export interface WorkflowLabActionResult {
  session: WorkflowLabSessionSummary;
  entry: WorkflowLabActionLogEntry;
}

export interface WorkflowLabWaitResult {
  session: WorkflowLabSessionSummary;
  condition: LabWaitCondition;
  satisfied: boolean;
  reason: string;
  elapsedMs: number;
  diagnostics: Record<string, unknown>;
}

interface WorkflowLabSessionState {
  id: string;
  mode: WorkflowLabSessionMode;
  targetUrl: string;
  profileWorkflowId?: WorkflowLabProfileWorkflowId;
  profileName?: string;
  clientId?: string;
  context?: BrowserContext;
  page?: Page;
  status: "ready" | "closed";
  title?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
  artifacts: WorkflowLabArtifactRef[];
  actionLog: WorkflowLabActionLogEntry[];
  stagedFiles: Map<string, WorkflowLabStagedFile>;
}

export class WorkflowLab {
  private readonly sessions = new Map<string, WorkflowLabSessionState>();

  constructor(
    private readonly paths: RuntimePaths,
    private readonly extensionBridge: ExtensionBridge
  ) {}

  async createSession(input: WorkflowLabSessionCreateInput): Promise<WorkflowLabSessionSummary> {
    if (input.mode !== "playwright" && input.mode !== "extension") {
      throw new Error("Workflow Lab session mode must be playwright or extension.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const targetUrl = input.targetUrl?.trim() || (input.mode === "extension" ? "" : "about:blank");
    const profileWorkflowId =
      input.mode === "playwright" ? resolveWorkflowLabProfileWorkflowId(input.profileWorkflowId) : undefined;
    const session: WorkflowLabSessionState = {
      id,
      mode: input.mode,
      targetUrl,
      ...(profileWorkflowId ? { profileWorkflowId } : {}),
      profileName: input.profileName?.trim() || defaultLabProfileName(profileWorkflowId),
      clientId: input.clientId?.trim() || undefined,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      artifacts: [],
      actionLog: [],
      stagedFiles: new Map()
    };

    ensureDir(this.getSessionDir(id));

    if (input.mode === "playwright") {
      session.context = await launchPersistentProfile({
        paths: this.paths,
        workflowId: session.profileWorkflowId ?? "workflow-lab",
        profileName: session.profileName ?? "lab"
      });
      session.page = session.context.pages()[0] ?? (await session.context.newPage());
      if (targetUrl && targetUrl !== "about:blank") {
        await session.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      session.url = session.page.url();
      session.title = await session.page.title().catch(() => "");
    } else {
      if (!session.clientId) {
        throw new Error("Workflow Lab extension sessions require a connected extension client id.");
      }
      const client = this.extensionBridge.findCompatibleClientForTarget({ mode: "existing", clientId: session.clientId });
      if (!client) {
        throw new Error("Selected extension tab is not connected or is running an incompatible extension.");
      }
      session.url = client.url;
      session.title = client.title;
      session.targetUrl = targetUrl || client.url;
    }

    this.sessions.set(id, session);
    this.addLog(session, "session.created", `Started ${input.mode} Workflow Lab session`, {
      targetUrl: session.targetUrl,
      profileWorkflowId: session.profileWorkflowId,
      profileName: session.profileName,
      clientId: session.clientId
    });
    return this.toSummary(session);
  }

  listSessions(): WorkflowLabSessionSummary[] {
    return [...this.sessions.values()].map((session) => this.toSummary(session));
  }

  getSession(sessionId: string): WorkflowLabSessionSummary {
    return this.toSummary(this.requireSession(sessionId));
  }

  async closeSession(sessionId: string): Promise<WorkflowLabSessionSummary> {
    const session = this.requireSession(sessionId);
    if (session.status === "closed") return this.toSummary(session);
    if (session.context) {
      await session.context.close();
    }
    session.status = "closed";
    session.updatedAt = new Date().toISOString();
    this.addLog(session, "session.closed", "Closed Workflow Lab session");
    return this.toSummary(session);
  }

  async inspect(sessionId: string): Promise<WorkflowLabInspectionResult> {
    const session = this.requireOpenSession(sessionId);
    const capturedAt = Date.now();
    const screenshotPath =
      session.mode === "playwright" ? path.join(this.getSessionDir(session.id), `screenshot-${capturedAt}.png`) : undefined;

    const raw =
      session.mode === "playwright"
        ? await this.inspectPlaywrightSession(session, screenshotPath)
        : await this.inspectExtensionSession(session);

    session.url = raw.url;
    session.title = raw.title;
    const inspection = buildInspectionModel(raw);

    const inspectionPath = path.join(this.getSessionDir(session.id), `inspection-${capturedAt}.json`);
    writeJson(inspectionPath, inspection);
    const inspectionArtifact = this.addArtifact(session, inspectionPath, "application/json");

    const artifacts = [inspectionArtifact];
    let screenshotBase64: string | undefined;
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      const screenshotArtifact = this.addArtifact(session, screenshotPath, "image/png");
      artifacts.push(screenshotArtifact);
      screenshotBase64 = fs.readFileSync(screenshotPath).toString("base64");
    }

    this.addLog(session, "inspection.captured", "Captured page inspection", {
      fingerprint: inspection.fingerprint,
      interactiveCount: inspection.interactiveElements.length,
      artifacts: artifacts.map((artifact) => artifact.name)
    });

    return {
      session: this.toSummary(session),
      inspection,
      ...(screenshotBase64 ? { screenshotBase64, screenshotMimeType: "image/png" } : {}),
      artifacts
    };
  }

  async runAction(sessionId: string, action: WorkflowLabAction): Promise<WorkflowLabActionResult> {
    const session = this.requireOpenSession(sessionId);
    assertLabAction(action);
    if (session.mode === "playwright") {
      await this.runPlaywrightAction(session, action);
    } else {
      await this.runExtensionAction(session, action);
    }

    const entry = this.addLog(session, "action.completed", describeAction(action), action);
    return { session: this.toSummary(session), entry };
  }

  getStagedFile(sessionId: string, fileId: string): { path: string; mimeType: string; name: string } {
    const session = this.requireOpenSession(sessionId);
    const stagedFile = session.stagedFiles.get(fileId);
    if (!stagedFile) throw new Error(`Workflow Lab staged file not found: ${fileId}`);
    if (!fs.existsSync(stagedFile.sourcePath)) throw new Error(`Workflow Lab staged file no longer exists: ${fileId}`);
    return { path: stagedFile.sourcePath, mimeType: stagedFile.mimeType, name: stagedFile.name };
  }

  async waitFor(sessionId: string, condition: LabWaitCondition): Promise<WorkflowLabWaitResult> {
    const session = this.requireOpenSession(sessionId);
    assertWaitCondition(condition);
    const startedAt = Date.now();
    const result =
      session.mode === "playwright"
        ? await this.waitForPlaywrightCondition(session, condition)
        : await this.waitForExtensionCondition(session, condition);
    const elapsedMs = Date.now() - startedAt;

    this.addLog(session, result.satisfied ? "wait.succeeded" : "wait.timed_out", result.reason, {
      condition,
      elapsedMs,
      diagnostics: result.diagnostics
    });

    return {
      session: this.toSummary(session),
      condition,
      satisfied: result.satisfied,
      reason: result.reason,
      elapsedMs,
      diagnostics: result.diagnostics
    };
  }

  private async inspectPlaywrightSession(session: WorkflowLabSessionState, screenshotPath?: string): Promise<LabRawPageState> {
    const page = this.requirePage(session);
    if (screenshotPath) {
      ensureDir(path.dirname(screenshotPath));
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    return page.evaluate(collectBrowserPageState);
  }

  private async inspectExtensionSession(session: WorkflowLabSessionState): Promise<LabRawPageState> {
    const result = await this.extensionBridge.executeLabCommand({
      clientId: session.clientId!,
      command: { kind: "inspect" },
      timeoutMs: 30_000
    });
    return assertRawPageState(result);
  }

  private async runPlaywrightAction(session: WorkflowLabSessionState, action: WorkflowLabAction): Promise<void> {
    const page = this.requirePage(session);
    if (action.kind === "attach-file") {
      await page.locator(action.selector).first().setInputFiles(action.filePaths);
      return;
    }

    const locator = page.locator(action.selector).first();
    if (action.kind === "fill") {
      await locator.fill(action.value);
      return;
    }
    await locator.click();
  }

  private async runExtensionAction(session: WorkflowLabSessionState, action: WorkflowLabAction): Promise<void> {
    const commandAction = action.kind === "attach-file" ? this.stageAttachFileAction(session, action) : action;
    await this.extensionBridge.executeLabCommand({
      clientId: session.clientId!,
      command: { kind: "action", action: commandAction },
      timeoutMs: 30_000
    });
  }

  private stageAttachFileAction(
    session: WorkflowLabSessionState,
    action: Extract<WorkflowLabAction, { kind: "attach-file" }>
  ): { kind: "attach-file"; selector: string; files: Array<Omit<WorkflowLabStagedFile, "sourcePath">> } {
    const files = action.filePaths.map((filePath) => {
      if (!fs.existsSync(filePath)) throw new Error(`Workflow Lab file not found: ${filePath}`);
      const id = randomUUID();
      const stagedFile: WorkflowLabStagedFile = {
        id,
        sourcePath: filePath,
        name: safeBaseName(filePath),
        mimeType: inferMimeType(filePath) ?? "application/octet-stream",
        url: `/api/lab/sessions/${session.id}/files/${id}`
      };
      session.stagedFiles.set(id, stagedFile);
      return {
        id: stagedFile.id,
        name: stagedFile.name,
        mimeType: stagedFile.mimeType,
        url: stagedFile.url
      };
    });

    return { kind: "attach-file", selector: action.selector, files };
  }

  private async waitForPlaywrightCondition(
    session: WorkflowLabSessionState,
    condition: LabWaitCondition
  ): Promise<LabWaitEvaluation> {
    const page = this.requirePage(session);
    const timeoutMs = defaultWaitTimeoutMs(condition);
    const startedAt = Date.now();

    if (condition.kind === "network-idle") {
      try {
        await page.waitForLoadState("networkidle", { timeout: timeoutMs });
        return { satisfied: true, reason: "Network is idle.", diagnostics: { timeoutMs } };
      } catch {
        return { satisfied: false, reason: "Timed out waiting for network idle.", diagnostics: { timeoutMs } };
      }
    }

    let lastEvaluation: LabWaitEvaluation = {
      satisfied: false,
      reason: "Wait has not evaluated yet.",
      diagnostics: {}
    };

    while (Date.now() - startedAt < timeoutMs) {
      const state = await page.evaluate(collectWaitPageState, condition);
      lastEvaluation = evaluateWaitCondition(condition, state);
      if (lastEvaluation.satisfied) return lastEvaluation;
      await sleep(350);
    }

    return {
      satisfied: false,
      reason: `Timed out: ${lastEvaluation.reason}`,
      diagnostics: {
        ...lastEvaluation.diagnostics,
        timeoutMs,
        label: waitConditionLabel(condition)
      }
    };
  }

  private async waitForExtensionCondition(
    session: WorkflowLabSessionState,
    condition: LabWaitCondition
  ): Promise<LabWaitEvaluation> {
    const result = await this.extensionBridge.executeLabCommand({
      clientId: session.clientId!,
      command: { kind: "wait", condition },
      timeoutMs: defaultWaitTimeoutMs(condition) + 5_000
    });
    return assertWaitEvaluation(result);
  }

  private requireSession(sessionId: string): WorkflowLabSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Workflow Lab session not found: ${sessionId}`);
    return session;
  }

  private requireOpenSession(sessionId: string): WorkflowLabSessionState {
    const session = this.requireSession(sessionId);
    if (session.status === "closed") throw new Error(`Workflow Lab session is closed: ${sessionId}`);
    return session;
  }

  private requirePage(session: WorkflowLabSessionState): Page {
    if (!session.page) throw new Error("Workflow Lab Playwright page is not available.");
    return session.page;
  }

  private toSummary(session: WorkflowLabSessionState): WorkflowLabSessionSummary {
    return {
      id: session.id,
      mode: session.mode,
      targetUrl: session.targetUrl,
      ...(session.profileWorkflowId ? { profileWorkflowId: session.profileWorkflowId } : {}),
      ...(session.profileName ? { profileName: session.profileName } : {}),
      ...(session.clientId ? { clientId: session.clientId } : {}),
      status: session.status,
      ...(session.title ? { title: session.title } : {}),
      ...(session.url ? { url: session.url } : {}),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      artifacts: session.artifacts,
      actionLog: session.actionLog
    };
  }

  private addArtifact(session: WorkflowLabSessionState, artifactPath: string, mimeType: string): WorkflowLabArtifactRef {
    const artifact: WorkflowLabArtifactRef = {
      name: path.basename(artifactPath),
      path: artifactPath,
      mimeType,
      size: fs.statSync(artifactPath).size
    };
    session.artifacts = [artifact, ...session.artifacts].slice(0, 40);
    session.updatedAt = new Date().toISOString();
    return artifact;
  }

  private addLog(
    session: WorkflowLabSessionState,
    type: string,
    message: string,
    data?: unknown
  ): WorkflowLabActionLogEntry {
    const entry: WorkflowLabActionLogEntry = {
      id: randomUUID(),
      type,
      message,
      ...(data === undefined ? {} : { data }),
      createdAt: new Date().toISOString()
    };
    session.actionLog = [entry, ...session.actionLog].slice(0, 100);
    session.updatedAt = entry.createdAt;
    return entry;
  }

  private getSessionDir(sessionId: string): string {
    return path.join(this.paths.workflowLabDir, sessionId);
  }
}

function describeAction(action: WorkflowLabAction): string {
  if (action.kind === "click") return `Clicked ${action.selector}`;
  if (action.kind === "fill") return `Filled ${action.selector}`;
  if (action.kind === "submit") return `Submitted ${action.selector}`;
  return `Attached ${action.filePaths.length} file(s) to ${action.selector}`;
}

function resolveWorkflowLabProfileWorkflowId(value: string | undefined): WorkflowLabProfileWorkflowId {
  if (!value) return "workflow-lab";
  if (value === "workflow-lab" || value === "hunyuan") return value;
  throw new Error("Workflow Lab profile owner must be workflow-lab or hunyuan.");
}

function defaultLabProfileName(profileWorkflowId: WorkflowLabProfileWorkflowId | undefined): string {
  return profileWorkflowId === "hunyuan" ? "default" : "lab";
}

function assertLabAction(action: WorkflowLabAction): void {
  if (!action || typeof action !== "object") throw new Error("Workflow Lab action is required.");
  if (!["click", "fill", "submit", "attach-file"].includes(action.kind)) {
    throw new Error("Unsupported Workflow Lab action kind.");
  }
  if (!("selector" in action) || typeof action.selector !== "string" || action.selector.trim().length === 0) {
    throw new Error("Workflow Lab action selector is required.");
  }
  if (action.kind === "attach-file" && (!Array.isArray(action.filePaths) || action.filePaths.length === 0)) {
    throw new Error("Workflow Lab attach-file action requires at least one file path.");
  }
}

function assertWaitCondition(condition: LabWaitCondition): void {
  if (!condition || typeof condition !== "object") throw new Error("Workflow Lab wait condition is required.");
  if (!["element", "text", "image-count", "stop-button", "chatgpt-submit-ready", "network-idle"].includes(condition.kind)) {
    throw new Error("Unsupported Workflow Lab wait condition kind.");
  }
}

function assertRawPageState(value: unknown): LabRawPageState {
  if (!value || typeof value !== "object") throw new Error("Extension returned an invalid inspection result.");
  const result = value as LabRawPageState;
  if (typeof result.url !== "string" || !Array.isArray(result.interactiveElements)) {
    throw new Error("Extension returned an invalid inspection result.");
  }
  return result;
}

function assertWaitEvaluation(value: unknown): LabWaitEvaluation {
  if (!value || typeof value !== "object") throw new Error("Extension returned an invalid wait result.");
  const result = value as LabWaitEvaluation;
  if (typeof result.satisfied !== "boolean" || typeof result.reason !== "string") {
    throw new Error("Extension returned an invalid wait result.");
  }
  return {
    satisfied: result.satisfied,
    reason: result.reason,
    diagnostics: result.diagnostics ?? {}
  };
}

function collectBrowserPageState(): LabRawPageState {
  const maxNodes = 900;
  let nodeCount = 0;

  function usefulAttributes(element: Element): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes)) {
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

  function elementText(element: Element): string {
    return (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
  }

  function toDomNode(element: Element, depth: number): LabRawDomNode | null {
    if (nodeCount >= maxNodes || depth > 7) return null;
    const tagName = element.tagName.toLowerCase();
    if (["script", "style", "noscript", "template", "svg"].includes(tagName)) return null;
    nodeCount += 1;
    const htmlElement = element as HTMLElement;
    const attrs = usefulAttributes(element);
    const children = Array.from(element.children)
      .slice(0, 40)
      .map((child) => toDomNode(child, depth + 1))
      .filter((child): child is LabRawDomNode => Boolean(child));

    return {
      tagName,
      text: children.length === 0 ? elementText(element) : "",
      id: element.id || attrs.id || "",
      className: htmlElement.className ? String(htmlElement.className) : attrs.class || "",
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

  function isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isInteractive(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    return (
      ["button", "input", "textarea", "select", "a", "summary"].includes(tagName) ||
      element.hasAttribute("role") ||
      element.hasAttribute("contenteditable") ||
      element.hasAttribute("onclick")
    );
  }

  function toInteractiveElement(element: Element): LabRawInteractiveElement {
    const rect = element.getBoundingClientRect();
    const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement | HTMLSelectElement;
    return {
      tagName: element.tagName.toLowerCase(),
      text: elementText(element),
      id: element.id || "",
      className: element instanceof HTMLElement ? String(element.className || "") : "",
      role: element.getAttribute("role") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      name: element.getAttribute("name") || "",
      type: element.getAttribute("type") || "",
      placeholder: element.getAttribute("placeholder") || "",
      disabled: Boolean("disabled" in input && input.disabled) || element.getAttribute("aria-disabled") === "true",
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

  function imageFingerprint(image: HTMLImageElement): string {
    return `${image.currentSrc || image.src}|${image.naturalWidth}x${image.naturalHeight}`;
  }

  return {
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyText: document.body?.innerText || "",
    imageFingerprints: Array.from(document.images)
      .filter((image) => image.naturalWidth > 0 && image.naturalHeight > 0 && Boolean(image.currentSrc || image.src))
      .map(imageFingerprint),
    dom: document.body ? toDomNode(document.body, 0) : null,
    interactiveElements: Array.from(document.querySelectorAll("a, button, input, textarea, select, summary, [role], [contenteditable], [onclick]"))
      .filter(isInteractive)
      .slice(0, 250)
      .map(toInteractiveElement)
  };
}

function collectWaitPageState(condition: LabWaitCondition): LabWaitPageState {
  type ChatGptSelectors = Extract<LabWaitCondition, { kind: "chatgpt-submit-ready" }>["selectors"];

  function isVisible(element: Element | null): boolean {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isDisabled(element: Element | null): boolean {
    if (!element) return false;
    const candidate = element as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    return Boolean("disabled" in candidate && candidate.disabled) || element.getAttribute("aria-disabled") === "true";
  }

  function getButtonLabel(button: Element | null): string {
    return `${button?.getAttribute("aria-label") || ""} ${button?.getAttribute("title") || ""} ${button?.textContent || ""}`
      .replace(/\s+/g, " ")
      .trim();
  }

  function isChatGptActiveStopButtonLabel(label: string): boolean {
    const normalized = String(label || "").trim();
    if (!normalized || /\bstopped\b/i.test(normalized)) return false;
    return (
      /^(stop|cancel)$/i.test(normalized) ||
      /^stop (generating|generation|streaming|response|thinking|request)$/i.test(normalized) ||
      /^cancel (generating|generation|streaming|response|request)$/i.test(normalized)
    );
  }

  function findVisibleElement(selectors: Array<string | undefined>): Element | null {
    for (const selector of selectors) {
      if (!selector) continue;
      const visible = Array.from(document.querySelectorAll(selector)).find((element) => isVisible(element));
      if (visible) return visible;
    }
    return null;
  }

  function findStopButton(selector?: string): Element | null {
    if (selector) {
      const configured = document.querySelector(selector);
      if (configured && isVisible(configured)) return configured;
    }
    const knownStopButton = findVisibleElement([
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
        return isVisible(button) && isChatGptActiveStopButtonLabel(getButtonLabel(button));
      }) ?? null
    );
  }

  function findFirst(selectors: Array<string | undefined>): Element | null {
    for (const selector of selectors) {
      if (!selector) continue;
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function findComposer(selectors?: ChatGptSelectors): Element | null {
    return findFirst([selectors?.composer, "#prompt-textarea", "textarea[data-id='root']", "textarea", "[contenteditable='true']"]);
  }

  function findSubmitButton(selectors?: ChatGptSelectors): Element | null {
    return findFirst([
      selectors?.submitButton,
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label='Send message']",
      "form button[type='submit']"
    ]);
  }

  function visibleButtonLabels(): string[] {
    return Array.from(document.querySelectorAll("button"))
      .filter((button) => isVisible(button))
      .slice(0, 12)
      .map((button) => getButtonLabel(button))
      .filter(Boolean);
  }

  function imageFingerprint(image: HTMLImageElement): string {
    return `${image.currentSrc || image.src}|${image.naturalWidth}x${image.naturalHeight}`;
  }

  const selector = condition.kind === "element" ? condition.selector : undefined;
  const element = selector ? document.querySelector(selector) : null;
  const imageSelector = condition.kind === "image-count" && condition.selector ? condition.selector : "img";
  const images = Array.from(document.querySelectorAll(imageSelector)).filter(
    (image): image is HTMLImageElement =>
      image instanceof HTMLImageElement &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0 &&
      Boolean(image.currentSrc || image.src)
  );
  const stopButton = findStopButton(condition.kind === "stop-button" ? condition.selector : undefined);
  const chatGptSelectors = condition.kind === "chatgpt-submit-ready" ? condition.selectors : undefined;
  const chatGptComposer = condition.kind === "chatgpt-submit-ready" ? findComposer(chatGptSelectors) : null;
  const chatGptSubmit = condition.kind === "chatgpt-submit-ready" ? findSubmitButton(chatGptSelectors) : null;
  const chatGptStop = condition.kind === "chatgpt-submit-ready" ? findStopButton(chatGptSelectors?.stopButton) : null;
  const chatGptFileInput =
    condition.kind === "chatgpt-submit-ready" ? findFirst([chatGptSelectors?.fileInput, "input[type='file']"]) : null;

  return {
    bodyText: document.body?.innerText || "",
    ...(selector
      ? {
          element: {
            selector,
            count: document.querySelectorAll(selector).length,
            visible: isVisible(element),
            disabled: isDisabled(element)
          }
        }
      : {}),
    imageFingerprints: images.map(imageFingerprint),
    stopButtonVisible: Boolean(stopButton),
    ...(condition.kind === "chatgpt-submit-ready"
      ? {
          chatGptSubmit: {
            composerFound: Boolean(chatGptComposer),
            composerVisible: isVisible(chatGptComposer),
            submitFound: Boolean(chatGptSubmit),
            submitVisible: isVisible(chatGptSubmit),
            submitEnabled: Boolean(chatGptSubmit) && isVisible(chatGptSubmit) && !isDisabled(chatGptSubmit),
            stopButtonVisible: Boolean(chatGptStop),
            stopButtonLabel: chatGptStop ? getButtonLabel(chatGptStop) : null,
            fileInputFound: Boolean(chatGptFileInput),
            visibleButtons: visibleButtonLabels(),
            imageCount: images.length
          }
        }
      : {})
  };
}
