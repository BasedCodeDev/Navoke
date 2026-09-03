import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { RuntimePaths } from "../runtime/types";
import { ensureDir } from "../runtime/paths";

export function configureBundledPlaywrightBrowsers(options: {
  resourcesPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string | undefined {
  const env = options.env ?? process.env;
  if (Object.prototype.hasOwnProperty.call(env, "PLAYWRIGHT_BROWSERS_PATH")) {
    return env.PLAYWRIGHT_BROWSERS_PATH;
  }

  const resourcesPath =
    options.resourcesPath ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return undefined;

  const bundledPath = path.join(resourcesPath, "playwright-browsers");
  if (!fs.existsSync(bundledPath)) return undefined;
  env.PLAYWRIGHT_BROWSERS_PATH = bundledPath;
  return bundledPath;
}

export async function launchPersistentProfile(input: {
  paths: RuntimePaths;
  workflowId: string;
  profileName: string;
  headless?: boolean;
}): Promise<BrowserContext> {
  const safeProfile = `${input.workflowId}-${input.profileName}`.replace(/[^\w.-]+/g, "_");
  const profileDir = path.join(input.paths.browserProfilesDir, safeProfile);
  ensureDir(profileDir);
  configureBundledPlaywrightBrowsers();
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(profileDir, {
    headless: input.headless ?? false,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 }
  });
}

export async function startTrace(context: BrowserContext, artifactDir: string): Promise<string> {
  const tracePath = path.join(artifactDir, "trace.zip");
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  return tracePath;
}

export async function stopTrace(context: BrowserContext, tracePath: string): Promise<void> {
  await context.tracing.stop({ path: tracePath });
}

export async function saveScreenshot(page: Page, artifactDir: string, name: string): Promise<string> {
  const screenshotPath = path.join(artifactDir, name);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

export function timeoutMinutes(minutes: number): number {
  return Math.max(1, minutes) * 60_000;
}
