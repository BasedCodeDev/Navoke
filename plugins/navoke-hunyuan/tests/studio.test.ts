import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createWorkflows, STUDIO_SELECTORS } from "../src";
import { abortableDelay, createExportGate, inspectGlb, isModelReady, manualActionReason, modelFailure, modelMetadata, projectApiBase, verifyRetainedReferences } from "../src/studioHelpers";
import type { WorkflowContext, WorkflowSdk } from "../src/sdkTypes";

const temporary: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hunyuan-studio-")); temporary.push(dir); return dir; }
function glb(overrides = {}): Buffer {
  const json = JSON.stringify({
    asset: { version: "2.0" }, meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ count: 3 }, { count: 3 }], materials: [{}], textures: [{ source: 0 }],
    images: [{ bufferView: 0 }], bufferViews: [{ buffer: 0, byteLength: 4 }], buffers: [{ byteLength: 4 }], ...overrides
  });
  const length = Math.ceil(Buffer.byteLength(json) / 4) * 4;
  const buffer = Buffer.alloc(12 + 8 + length + 8 + 4);
  buffer.write("glTF"); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(length, 12); buffer.writeUInt32LE(0x4e4f534a, 16);
  buffer.fill(32, 20, 20 + length); buffer.write(json, 20);
  buffer.writeUInt32LE(4, 20 + length); buffer.writeUInt32LE(0x004e4942, 24 + length);
  return buffer;
}

describe("Studio readiness and metadata", () => {
  it("ignores sibling failures and progress but rejects the active model's failure", () => {
    expect(modelFailure("Texture Painting 36% Assets\nLayer\nProperty\nGeneration Failed")).toBeNull();
    expect(modelFailure("Texture Painting Server is overloaded, please try again later Assets Layer Property")).toMatch(/overloaded/);
    expect(modelFailure("Generation Failed Assets Layer Property")).toMatch(/Failed/);
    expect(isModelReady("Vertex Count 25002 Download Assets Layer Property 99% Generation Failed")).toBe(true);
    expect(isModelReady("Retopology 99% Assets Layer Property Vertex Count 30")).toBe(false);
  });
  it.each(["Generating... 99%", "Loading...", "Queuing"])("does not accept an old mesh while %s", (state) => {
    expect(isModelReady(`Vertex Count 1410 ${state} Download`)).toBe(false);
  });
  it("requires actual mesh information", () => {
    expect(isModelReady("Geometry Generation Loading... Download Assets Layer Property")).toBe(false);
    expect(isModelReady("Retopologize Triangles Model Face Count 2815 Vertex Count 1410 Download")).toBe(true);
  });
  it("distinguishes manual gates from ordinary Studio UI", () => {
    expect(manualActionReason("Sign in with Google")).toMatch(/Sign in/);
    expect(manualActionReason("Verify you are human")).toMatch(/verification/);
    expect(manualActionReason("Vertex Count 20 Image-to-Texture")).toBeNull();
  });
  it.each(["Quads", "Triangles", "Original"] as const)("records %s and actual geometry counts", (topology) => {
    expect(modelMetadata({ frontImage: "front.png", backImage: "back.png", topology }, glb())).toMatchObject({
      topology, requestedGeometryFaces: 50000, vertexCount: 3, triangleCount: 1,
      retopology: topology === "Original" ? null : { type: topology, density: "Medium" }
    });
  });
  it("rejects truncated, non-GLB, malformed chunk and external texture downloads", () => {
    expect(() => inspectGlb(Buffer.from("glTF"))).toThrow(/Invalid GLB/);
    expect(() => inspectGlb(Buffer.alloc(32))).toThrow(/Invalid GLB/);
    const truncated = glb(); truncated.writeUInt32LE(0xfffffff0, 12);
    expect(() => inspectGlb(truncated)).toThrow(/Invalid GLB/);
    expect(() => inspectGlb(glb({ images: [{ uri: "texture.png" }] }))).toThrow(/embedded/);
    expect(() => inspectGlb(glb({ meshes: [] }))).toThrow(/mesh/);
    expect(() => inspectGlb(glb({ accessors: [{ count: 0 }, { count: 3 }] }))).toThrow(/accessors/);
  });
  it("requires both retained references", () => {
    expect(() => verifyRetainedReferences(["a", "b"], [{ src: "a" }, { src: "b" }])).not.toThrow();
    expect(() => verifyRetainedReferences(["a", "b"], [{ src: "a" }])).toThrow(/both/);
  });
  it("validates project-local runtime discovery", () => {
    const dir = tempDir(); fs.mkdirSync(path.join(dir, ".navoke"));
    const file = path.join(dir, ".navoke/runtime.json");
    fs.writeFileSync(file, JSON.stringify({ projectDir: dir, apiBaseUrl: "http://127.0.0.1:39201" }));
    expect(projectApiBase(dir)).toBe("http://127.0.0.1:39201");
    fs.writeFileSync(file, JSON.stringify({ projectDir: dir, apiBaseUrl: "https://example.com" }));
    expect(() => projectApiBase(dir)).toThrow(/project-local/);
    fs.writeFileSync(file, JSON.stringify({ projectDir: path.join(dir, "other"), apiBaseUrl: "http://127.0.0.1:39201" }));
    expect(() => projectApiBase(dir)).toThrow(/different project/);
  });
});

describe("cancellation", () => {
  it("serializes three exports in FIFO order", async () => {
    const acquire = createExportGate(); const signal = new AbortController().signal;
    const order: number[] = [];
    const first = await acquire(signal);
    const second = acquire(signal).then((release) => { order.push(2); release(); });
    const third = acquire(signal).then((release) => { order.push(3); release(); });
    await Promise.resolve(); expect(order).toEqual([]);
    first(); await Promise.all([second, third]); expect(order).toEqual([2, 3]);
  });
  it("cancels an export waiter promptly without releasing the active owner's lock", async () => {
    const acquire = createExportGate(); const active = new AbortController(); const cancelled = new AbortController();
    const release = await acquire(active.signal);
    const waiter = acquire(cancelled.signal);
    const rejected = expect(waiter).rejects.toThrow("stop"); cancelled.abort(new Error("stop")); await rejected;
    let entered = false;
    const next = acquire(active.signal).then((unlock) => { entered = true; unlock(); });
    await Promise.resolve(); expect(entered).toBe(false);
    release(); await next; expect(entered).toBe(true);
  });
  it("rejects an already aborted delay and stops a pending delay", async () => {
    const controller = new AbortController(); const wait = abortableDelay(60_000, controller.signal);
    const rejected = expect(wait).rejects.toThrow("stop"); controller.abort(new Error("stop")); await rejected;
    expect(() => abortableDelay(1, controller.signal)).toThrow("stop");
  });
});

function harness(settings: { failStage?: number; loginAfterGeometry?: boolean; disconnected?: boolean; abortStage?: number; invalidDownload?: boolean } = {}) {
  const dir = tempDir(); fs.mkdirSync(path.join(dir, ".navoke"));
  fs.writeFileSync(path.join(dir, ".navoke/runtime.json"), JSON.stringify({ projectDir: dir, apiBaseUrl: "http://127.0.0.1:39201" }));
  const frontImage = path.join(dir, "front.png"); const backImage = path.join(dir, "back.png");
  fs.writeFileSync(frontImage, "png"); fs.writeFileSync(backImage, "png");
  const downloaded = path.join(dir, "download.glb"); fs.writeFileSync(downloaded, settings.invalidDownload ? Buffer.from("invalid") : glb());
  const controller = new AbortController();
  const artifacts: Array<{ id: string; name: string; metadata?: unknown }> = [];
  const actions: Array<{ kind: string; selector: string }> = [];
  const routes: string[] = [];
  let stage = 0; let runningReads = 0; let login = false; let disconnected = settings.disconnected;
  const uploaded = new Set<string>();
  const client = { id: "owned", tabId: 101, controllerId: "controller", url: "https://hy3d.tencent.ai/studio/creation/prop/geo" };
  const browser = {
    ensureRoutedTab: vi.fn(async () => client), findCompatibleClientForTarget: vi.fn(() => disconnected ? undefined : client),
    closeTab: vi.fn(async () => undefined), inspect: vi.fn(async () => ({ text: "failure inspection" })),
    startDownloadWatch: vi.fn(() => ({ id: "watch" })), waitForDownload: vi.fn(async () => ({ filename: downloaded })),
    extract: vi.fn(async (_target, query) => {
      if (disconnected) throw new Error("disconnected");
      if (query.kind === "images") return { images: ["a", "b"].map((value) => ({ src: `https://example.com/ref_${value.repeat(32)}.png` })) };
      if (query.kind === "element-state") return { count: 1, visible: true, text: uploaded.has(query.selector) ? "image" : query.selector.includes("nth-child(2)") ? "Front View" : "Back View" };
      if (login) return { text: "Session expired. Sign in with Google" };
      if (runningReads > 0) { runningReads--; return { text: "Generating... 36% Assets Layer Property Generation Failed" }; }
      if (settings.failStage === stage) return { text: "Server is overloaded" };
      return { text: "Image to Geometry Vertex Count 3 Download Assets Layer Property Generation Failed" };
    })
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const route = new URL(url).pathname; routes.push(`${init.method} ${route}`);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    let result: unknown = {};
    if (route === "/api/system") result = { paths: { projectDir: dir } };
    if (route === "/api/lab/sessions") result = { id: "session" };
    if (route.endsWith("/wait")) result = { satisfied: true };
    if (route.endsWith("/actions")) {
      const action = body.action; actions.push(action);
      if (action.selector === STUDIO_SELECTORS.addViews) uploaded.clear();
      if (action.kind === "attach-file") uploaded.add(action.selector.replace(" input[type=file]", ""));
      if (action.selector === STUDIO_SELECTORS.generate) { stage++; runningReads = 1; if (settings.abortStage === stage) controller.abort(new Error("cancel run")); }
      if (settings.loginAfterGeometry && action.selector === STUDIO_SELECTORS.retopology) login = true;
    }
    return { ok: true, json: async () => result };
  }));
  const ctx: WorkflowContext = {
    paths: { projectDir: dir }, artifactDir: dir, runId: "run", signal: controller.signal,
    step: vi.fn(async () => undefined), event: vi.fn(async () => undefined),
    addArtifact: vi.fn(async (value) => { const artifact = { id: `artifact-${artifacts.length}`, ...value }; artifacts.push(artifact); return artifact; }),
    waitForManualAction: vi.fn(async () => { login = false; disconnected = false; })
  };
  const sdk = { schema: { z }, extension: { browser } } as unknown as WorkflowSdk;
  const workflow = createWorkflows(sdk)[0];
  return { workflow, ctx, browser, artifacts, actions, routes, input: { frontImage, backImage }, dir };
}

describe("Studio pipeline", () => {
  it("validates the new contract and rejects obsolete settings", () => {
    const { workflow } = harness();
    expect(workflow.inputSchema.safeParse({ frontImage: "a" }).success).toBe(false);
    expect(workflow.inputSchema.safeParse({ frontImage: " ", backImage: "b" }).success).toBe(false);
    expect(workflow.inputSchema.safeParse({ frontImage: "a", backImage: "b", topology: "Bad" }).success).toBe(false);
    expect(workflow.inputSchema.safeParse({ frontImage: "a", backImage: "b", exportFormat: "obj" }).success).toBe(false);
    expect(workflow.inputSchema.parse({ frontImage: "a", backImage: "b" })).toMatchObject({ topology: "Quads" });
  });
  it.each(["Quads", "Triangles", "Original"] as const)("runs %s with the correct phases, artifacts and owned-window cleanup", async (topology) => {
    const h = harness();
    const result = await h.workflow.run(h.workflow.inputSchema.parse({ ...h.input, topology }), h.ctx) as { artifactIds: string[] };
    expect(h.actions.filter((a) => a.selector === STUDIO_SELECTORS.generate)).toHaveLength(topology === "Original" ? 2 : 3);
    expect(h.actions.filter((a) => a.kind === "attach-file")).toHaveLength(topology === "Original" ? 2 : 4);
    expect(h.actions.some((a) => a.selector === STUDIO_SELECTORS.retopology)).toBe(topology !== "Original");
    if (topology !== "Original") expect(h.actions.some((a) => a.selector === STUDIO_SELECTORS.topology(topology))).toBe(true);
    expect(h.browser.ensureRoutedTab.mock.calls[0][0]).toMatchObject({ mode: "new", background: true, openMode: "window" });
    expect(h.artifacts.find((a) => a.name === "prop.glb")?.metadata).toMatchObject({ topology, triangleCount: 1 });
    expect(h.artifacts.map((a) => a.name)).toEqual(expect.arrayContaining(["model-manifest.json", "workflow-lab-session.json", "lab-before-25.json", "lab-running-75.json", "lab-complete-75.json"]));
    expect(result.artifactIds).toEqual(h.artifacts.map((a) => a.id));
    expect(h.browser.closeTab).toHaveBeenCalledExactlyOnceWith(101, { controllerId: "controller", timeoutMs: 15_000 });
    expect(h.routes).toContain("DELETE /api/lab/sessions/session");
  });
  it("resumes login between stages without regenerating completed geometry", async () => {
    const h = harness({ loginAfterGeometry: true });
    await h.workflow.run(h.workflow.inputSchema.parse(h.input), h.ctx);
    expect(h.ctx.waitForManualAction).toHaveBeenCalledOnce();
    expect(h.actions.filter((a) => a.selector === STUDIO_SELECTORS.generate)).toHaveLength(3);
  });
  it("resumes controller disconnection at the current read", async () => {
    const h = harness({ disconnected: true });
    await h.workflow.run(h.workflow.inputSchema.parse(h.input), h.ctx);
    expect(h.ctx.waitForManualAction).toHaveBeenCalledOnce();
    expect(h.browser.ensureRoutedTab).toHaveBeenCalledOnce();
  });
  it.each([{ failStage: 2 }, { abortStage: 2 }, { invalidDownload: true }])("preserves diagnostics and closes owned resources on %j", async (settings) => {
    const h = harness(settings);
    await expect(h.workflow.run(h.workflow.inputSchema.parse(h.input), h.ctx)).rejects.toThrow();
    expect(h.artifacts.map((a) => a.name)).toEqual(expect.arrayContaining(["last-ui-state.json", "workflow-lab-session.json"]));
    expect(h.artifacts.some((a) => a.name === "prop.glb")).toBe(false);
    expect(h.browser.closeTab).toHaveBeenCalledOnce();
    expect(h.routes).toContain("DELETE /api/lab/sessions/session");
  });
  it("releases the shared export lock after a rejected download", async () => {
    const failed = harness({ invalidDownload: true });
    await expect(failed.workflow.run(failed.workflow.inputSchema.parse(failed.input), failed.ctx)).rejects.toThrow(/Invalid GLB/);
    const next = harness();
    await expect(next.workflow.run(next.workflow.inputSchema.parse(next.input), next.ctx)).resolves.toMatchObject({ summary: expect.stringContaining("Textured GLB") });
  });
});
