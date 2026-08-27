import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_API_URL, discoverRuntime } from "../../src/cli/runtimeDiscovery";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("CLI runtime discovery", () => {
  it("uses an explicit API URL before other sources", async () => {
    const runtime = await discoverRuntime({
      apiUrl: "http://127.0.0.1:4999/",
      env: { NAVOKE_API_URL: "http://127.0.0.1:4000" }
    });

    expect(runtime).toMatchObject({ apiUrl: "http://127.0.0.1:4999", source: "flag" });
  });

  it("uses NAVOKE_API_URL when no explicit URL is provided", async () => {
    const runtime = await discoverRuntime({ env: { NAVOKE_API_URL: "http://127.0.0.1:4000/" } });

    expect(runtime).toMatchObject({ apiUrl: "http://127.0.0.1:4000", source: "env" });
  });

  it("prefers NAVOKE_API_URL while accepting the legacy API URL variable", async () => {
    const canonical = await discoverRuntime({
      env: {
        NAVOKE_API_URL: "http://127.0.0.1:4001/",
        BASED_BLINK_API_URL: "http://127.0.0.1:4002/"
      }
    });
    const legacy = await discoverRuntime({ env: { BASED_BLINK_API_URL: "http://127.0.0.1:4002/" } });

    expect(canonical).toMatchObject({ apiUrl: "http://127.0.0.1:4001", source: "env" });
    expect(legacy).toMatchObject({ apiUrl: "http://127.0.0.1:4002", source: "env" });
  });

  it("uses a healthy project runtime file", async () => {
    const projectDir = tempDir();
    writeRuntimeFile(projectDir, "http://127.0.0.1:4333");

    const runtime = await discoverRuntime(
      { projectPath: projectDir, env: {} },
      { healthCheck: async (apiUrl) => apiUrl === "http://127.0.0.1:4333" }
    );

    expect(runtime).toMatchObject({
      apiUrl: "http://127.0.0.1:4333",
      source: "runtime-file",
      runtimeFile: path.join(projectDir, ".navoke", "runtime.json")
    });
  });

  it("searches parent folders for a healthy runtime file", async () => {
    const projectDir = tempDir();
    const childDir = path.join(projectDir, "nested", "work");
    fs.mkdirSync(childDir, { recursive: true });
    writeRuntimeFile(projectDir, "http://127.0.0.1:4555");

    const runtime = await discoverRuntime(
      { cwd: childDir, env: {} },
      { healthCheck: async (apiUrl) => apiUrl === "http://127.0.0.1:4555" }
    );

    expect(runtime).toMatchObject({ apiUrl: "http://127.0.0.1:4555", source: "runtime-file" });
  });

  it("accepts a legacy project runtime pointer when canonical storage is absent", async () => {
    const projectDir = tempDir();
    writeRuntimeFile(projectDir, "http://127.0.0.1:4556", ".blink");

    const runtime = await discoverRuntime(
      { projectPath: projectDir, env: {} },
      { healthCheck: async (apiUrl) => apiUrl === "http://127.0.0.1:4556" }
    );

    expect(runtime).toMatchObject({
      apiUrl: "http://127.0.0.1:4556",
      source: "runtime-file",
      runtimeFile: path.join(projectDir, ".blink", "runtime.json")
    });
  });

  it("falls back to the default URL for a stale runtime file", async () => {
    const projectDir = tempDir();
    writeRuntimeFile(projectDir, "http://127.0.0.1:4666");

    const runtime = await discoverRuntime({ projectPath: projectDir, env: {} }, { healthCheck: async () => false });

    expect(runtime).toMatchObject({
      apiUrl: DEFAULT_API_URL,
      source: "default",
      staleRuntimeFile: path.join(projectDir, ".navoke", "runtime.json")
    });
  });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-runtime-discovery-"));
  tempDirs.push(dir);
  return dir;
}

function writeRuntimeFile(projectDir: string, apiBaseUrl: string, internalDirName = ".navoke"): void {
  const navokeDir = path.join(projectDir, internalDirName);
  fs.mkdirSync(navokeDir, { recursive: true });
  fs.writeFileSync(path.join(navokeDir, "runtime.json"), `${JSON.stringify({ apiBaseUrl }, null, 2)}\n`, "utf8");
}
