const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

async function main() {
  if (process.platform !== "win32") throw new Error("The packaged-app smoke test requires Windows.");
  const executablePath = path.resolve(process.argv[2] || "");
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error(`Packaged Navoke executable not found: ${executablePath || "<missing>"}`);
  }
  const bundledManifests = readBundledPluginManifests(executablePath);
  if (bundledManifests.length !== 3) {
    throw new Error(`Expected 3 bundled plugin manifests, found ${bundledManifests.length}.`);
  }
  const expectedPlugins = bundledManifests.map((manifest) => `${manifest.id}@${manifest.version}`).sort();
  const expectedWorkflows = bundledManifests.flatMap((manifest) => manifest.workflows).sort();
  if (expectedWorkflows.length !== 8) {
    throw new Error(`Expected 8 bundled workflows, found ${expectedWorkflows.length}.`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "navoke-package-smoke-"));
  const userDataDir = path.join(tempRoot, "user-data");
  const projectDir = path.join(tempRoot, "project");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, "settings.json"),
    `${JSON.stringify({ lastProjectDir: projectDir, recentProjectDirs: [projectDir] }, null, 2)}\n`,
    "utf8"
  );

  const output = [];
  const child = spawn(executablePath, [], {
    env: { ...process.env, NAVOKE_USER_DATA_DIR: userDataDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));

  let sessionId;
  try {
    const pointerPath = path.join(projectDir, ".navoke", "runtime.json");
    const pointer = await waitForJsonFile(pointerPath, child, output, 60_000);
    if (typeof pointer.apiBaseUrl !== "string") throw new Error(`Invalid runtime pointer: ${JSON.stringify(pointer)}`);
    const apiBaseUrl = pointer.apiBaseUrl;

    const health = await fetchJson(`${apiBaseUrl}/api/health`);
    if (health.ok !== true) throw new Error(`Unexpected health response: ${JSON.stringify(health)}`);

    const pluginResult = await fetchJson(`${apiBaseUrl}/api/plugins`);
    const pluginKeys = pluginResult.plugins
      .filter((plugin) => plugin.status === "loaded")
      .map((plugin) => `${plugin.pluginId}@${plugin.version}`)
      .sort();
    assertEqual(pluginKeys, expectedPlugins, "loaded plugins");

    const workflows = await fetchJson(`${apiBaseUrl}/api/workflows`);
    const workflowIds = workflows.map((workflow) => workflow.manifest.id).sort();
    assertEqual(workflowIds, expectedWorkflows, "workflows");

    const session = await fetchJson(`${apiBaseUrl}/api/lab/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "playwright", targetUrl: "about:blank", profileName: "release-smoke" })
    });
    sessionId = session.id;
    if (!sessionId || session.mode !== "playwright" || session.url !== "about:blank") {
      throw new Error(`Unexpected Workflow Lab session: ${JSON.stringify(session)}`);
    }
    await fetchJson(`${apiBaseUrl}/api/lab/sessions/${sessionId}`, { method: "DELETE" });
    sessionId = undefined;

    process.stdout.write(
      `${JSON.stringify({ executablePath, plugins: pluginKeys.length, workflows: workflowIds.length, playwright: "ok" })}\n`
    );
  } finally {
    terminateProcessTree(child);
    await wait(500);
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(`Could not remove smoke-test directory ${tempRoot}: ${formatError(error)}\n`);
    }
  }
}

function readBundledPluginManifests(executablePath) {
  const pluginRoot = path.join(path.dirname(executablePath), "resources", "plugins");
  if (!fs.existsSync(pluginRoot)) throw new Error(`Bundled plugin directory not found: ${pluginRoot}`);
  return fs
    .readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginRoot, entry.name, "plugin.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(fs.readFileSync(manifestPath, "utf8")));
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method || "GET"} ${url} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function waitForJsonFile(filePath, child, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (child.exitCode !== null) {
      throw new Error(`Navoke exited before startup completed (${child.exitCode}).\n${output.join("")}`);
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${filePath}.\n${output.join("")}`);
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected ${label}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
