import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureBundledPlaywrightBrowsers } from "../../src/main/automation/browserHarness";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("bundled Playwright browser resolution", () => {
  it("preserves an explicitly configured browser path", () => {
    const env = { PLAYWRIGHT_BROWSERS_PATH: "C:\\custom\\browsers" };

    expect(configureBundledPlaywrightBrowsers({ resourcesPath: "C:\\app\\resources", env })).toBe(
      "C:\\custom\\browsers"
    );
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("C:\\custom\\browsers");
  });

  it("uses the packaged browser directory when no override is present", () => {
    const resourcesPath = tempDir("navoke-resources-");
    const bundledPath = path.join(resourcesPath, "playwright-browsers");
    fs.mkdirSync(bundledPath);
    const env: NodeJS.ProcessEnv = {};

    expect(configureBundledPlaywrightBrowsers({ resourcesPath, env })).toBe(bundledPath);
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(bundledPath);
  });

  it("leaves Playwright on its default cache when no bundle exists", () => {
    const env: NodeJS.ProcessEnv = {};

    expect(configureBundledPlaywrightBrowsers({ resourcesPath: tempDir("navoke-resources-"), env })).toBeUndefined();
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
  });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
