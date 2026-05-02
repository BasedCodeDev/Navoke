import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { RuntimePaths } from "../runtime/types";
import { ensureDir } from "../runtime/paths";

export async function launchPersistentProfile(input: {
  paths: RuntimePaths;
  workflowId: string;
  profileName: string;
  headless?: boolean;
}): Promise<BrowserContext> {
  const safeProfile = `${input.workflowId}-${input.profileName}`.replace(/[^\w.-]+/g, "_");
  const profileDir = path.join(input.paths.browserProfilesDir, safeProfile);
  ensureDir(profileDir);
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
