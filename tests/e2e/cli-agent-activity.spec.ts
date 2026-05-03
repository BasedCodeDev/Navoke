import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

const repoRoot = path.resolve(__dirname, "../..");
const cliPath = path.join(repoRoot, "dist", "cli", "index.js");
const electronMainPath = path.join(repoRoot, "dist", "main", "main.js");
const fixturePluginPath = path.join(__dirname, "fixtures", "cli-visible-plugin");
const workflowId = "based-blink.test.cli-visible";

interface AppConfigLike {
  apiBaseUrl: string;
  projectDir: string | null;
}

interface BlinkEvent {
  type?: string;
  run?: {
    id?: string;
    status?: string;
  };
  [key: string]: unknown;
}

interface BlinkProcess {
  child: ChildProcessWithoutNullStreams;
  events: BlinkEvent[];
  stderr: string[];
  completion: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  waitForEvent(type: string, timeoutMs?: number): Promise<BlinkEvent>;
}

test.describe("CLI-origin runs", () => {
  test.setTimeout(90_000);

  test("exits a second Electron launch for the same user data directory", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blink-single-instance-e2e-"));
    const projectDir = path.join(tempRoot, "project");
    const userDataDir = path.join(tempRoot, "user-data");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });

    let app: ElectronApplication | null = null;
    let secondLaunch: ChildProcessWithoutNullStreams | null = null;
    try {
      app = await electron.launch({
        args: [electronMainPath],
        cwd: repoRoot,
        env: {
          ...stringEnv(process.env),
          BASED_BLINK_USER_DATA_DIR: userDataDir
        }
      });
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByRole("heading", { name: "Based BLINK", level: 1 })).toBeVisible();

      const config = await openProject(page, projectDir);
      expect(config.projectDir).toBe(projectDir);
      expect(config.apiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      secondLaunch = spawn(resolveElectronExecutablePath(), [electronMainPath], {
        cwd: repoRoot,
        env: {
          ...stringEnv(process.env),
          BASED_BLINK_USER_DATA_DIR: userDataDir
        }
      });
      const secondExit = await waitForProcessClose(secondLaunch, 15_000);
      expect(secondExit).toEqual({ code: 0, signal: null });

      const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      expect(windowCount).toBe(1);
      const configAfterSecondLaunch = await getConfig(page);
      expect(configAfterSecondLaunch.apiBaseUrl).toBe(config.apiBaseUrl);
      expect(configAfterSecondLaunch.projectDir).toBe(projectDir);
    } finally {
      if (secondLaunch && secondLaunch.exitCode === null) {
        secondLaunch.kill();
      }
      await app?.close().catch(() => undefined);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("shows a blink CLI workflow run in the UI while active and after completion", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "blink-cli-e2e-"));
    const projectDir = path.join(tempRoot, "project");
    const userDataDir = path.join(tempRoot, "user-data");
    const inputFile = path.join(tempRoot, "input.json");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(inputFile, `${JSON.stringify({ delayMs: 8000 })}\n`, "utf8");

    let app: ElectronApplication | null = null;
    let blinkRun: BlinkProcess | null = null;
    try {
      app = await electron.launch({
        args: [electronMainPath],
        cwd: repoRoot,
        env: {
          ...stringEnv(process.env),
          BASED_BLINK_USER_DATA_DIR: userDataDir
        }
      });
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");

      const config = await openProject(page, projectDir);
      expect(config.projectDir).toBe(projectDir);
      expect(config.apiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();

      await runBlinkJson(["--project", projectDir, "plugin-install", fixturePluginPath]);
      const workflows = await runBlinkJson(["--project", projectDir, "workflows"]);
      expect(JSON.stringify(workflows)).toContain(workflowId);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();

      blinkRun = startBlink([
        "--project",
        projectDir,
        "run",
        workflowId,
        "--input",
        inputFile,
        "--name",
        "CLI Visible Test Run",
        "--agent",
        "codex-e2e",
        "--wait"
      ]);
      const created = await blinkRun.waitForEvent("run.created");
      expect(created.run?.id).toBeTruthy();

      await expect(page.getByText("CLI agents: 1")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("CLI Agent Activity")).toBeVisible();
      const activeRunCard = visibleRunButton(page);
      await expect(activeRunCard).toBeVisible();
      await expect(activeRunCard).toContainText(workflowId);
      await expect(activeRunCard).toContainText("CLI integration started");
      await expect(activeRunCard).toContainText("CLI: codex-e2e");

      const completed = await waitForCompletedRun(blinkRun);
      expect(completed.run?.id).toBe(created.run?.id);
      expect(completed.run?.status).toBe("completed");
      await expect(page.getByText("CLI agents: 1")).toBeHidden({ timeout: 15_000 });
      const completedRunRow = visibleRunButton(page);
      await expect(completedRunRow).toBeVisible();
      await expect(completedRunRow).toContainText("Completed");
      await expect(page.getByText("CLI: codex-e2e").first()).toBeVisible();

      await completedRunRow.click();
      await expect(page.getByRole("heading", { name: "Run Detail" })).toBeVisible();
      await expect(page.getByText("CLI: codex-e2e").first()).toBeVisible();
      await expect(page.getByText(/blink .*based-blink\.test\.cli-visible/).first()).toBeVisible();
      await expect(page.getByText(`cwd: ${repoRoot}`).first()).toBeVisible();
    } finally {
      if (blinkRun && blinkRun.child.exitCode === null) {
        blinkRun.child.kill();
      }
      await app?.close().catch(() => undefined);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

function visibleRunButton(page: Page) {
  return page.getByRole("button").filter({ hasText: "CLI Visible Test Run" }).filter({ hasText: workflowId }).first();
}

async function openProject(page: Page, projectDir: string): Promise<AppConfigLike> {
  return page.evaluate(async (targetProjectDir) => {
    const win = window as typeof window & {
      basedBlink: {
        openProject(path?: string): Promise<AppConfigLike>;
      };
    };
    return win.basedBlink.openProject(targetProjectDir);
  }, projectDir);
}

async function getConfig(page: Page): Promise<AppConfigLike> {
  return page.evaluate(async () => {
    const win = window as typeof window & {
      basedBlink: {
        getConfig(): Promise<AppConfigLike>;
      };
    };
    return win.basedBlink.getConfig();
  });
}

function resolveElectronExecutablePath(): string {
  const electronPackageDir = path.join(repoRoot, "node_modules", "electron");
  const electronExecutable = fs.readFileSync(path.join(electronPackageDir, "path.txt"), "utf8").trim();
  const overrideDistPath = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  return overrideDistPath
    ? path.join(overrideDistPath, electronExecutable || "electron")
    : path.join(electronPackageDir, "dist", electronExecutable);
}

function waitForProcessClose(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: null });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for process ${child.pid ?? "unknown"} to exit.`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function runBlinkJson(args: string[]): Promise<Record<string, unknown>> {
  const result = await runProcess(process.execPath, [cliPath, ...args], repoRoot);
  if (result.code !== 0) {
    throw new Error(`blink ${args.join(" ")} failed with ${result.code}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

function runProcess(
  file: string,
  args: string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function startBlink(args: string[]): BlinkProcess {
  const child = spawn(process.execPath, [cliPath, ...args], { cwd: repoRoot, env: process.env });
  const events: BlinkEvent[] = [];
  const stderr: string[] = [];
  const waiters: Array<{
    type: string;
    resolve(event: BlinkEvent): void;
    reject(error: Error): void;
    timeout: NodeJS.Timeout;
  }> = [];
  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    stdoutBuffer = drainLines(stdoutBuffer, (line) => {
      const event = JSON.parse(line) as BlinkEvent;
      events.push(event);
      for (const waiter of [...waiters]) {
        if (event.type === waiter.type) {
          clearTimeout(waiter.timeout);
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    });
  });
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
    stderrBuffer = drainLines(stderrBuffer, (line) => stderr.push(line));
  });

  const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, signal) => {
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error(`blink exited before ${waiter.type}: ${stderr.join("\n")}`));
      }
      resolve({ code, signal });
    });
  });

  return {
    child,
    events,
    stderr,
    completion,
    waitForEvent(type: string, timeoutMs = 20_000): Promise<BlinkEvent> {
      const existing = events.find((event) => event.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for blink event ${type}. stderr: ${stderr.join("\n")}`));
        }, timeoutMs);
        waiters.push({ type, resolve, reject, timeout });
      });
    }
  };
}

async function waitForCompletedRun(process: BlinkProcess): Promise<BlinkEvent> {
  const completion = await process.completion;
  if (completion.code !== 0) {
    throw new Error(`blink run failed with ${completion.code}: ${process.stderr.join("\n")}`);
  }
  const completed = [...process.events].reverse().find((event) => event.type === "run.updated" && event.run?.status === "completed");
  if (!completed) {
    throw new Error(`blink run completed without a terminal run.updated event: ${JSON.stringify(process.events)}`);
  }
  return completed;
}

function drainLines(buffer: string, onLine: (line: string) => void): string {
  let next = buffer;
  while (true) {
    const newlineIndex = next.indexOf("\n");
    if (newlineIndex < 0) return next;
    const line = next.slice(0, newlineIndex).trim();
    next = next.slice(newlineIndex + 1);
    if (line) onLine(line);
  }
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
