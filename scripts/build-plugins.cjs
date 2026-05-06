const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const pluginsRoot = path.join(repoRoot, "plugins");
const noEmit = process.argv.includes("--noEmit");

const pluginProjects = fs.existsSync(pluginsRoot)
  ? fs
      .readdirSync(pluginsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(pluginsRoot, entry.name, "tsconfig.json"))
      .filter((tsconfigPath) => fs.existsSync(tsconfigPath))
      .sort((left, right) => left.localeCompare(right))
  : [];

for (const tsconfigPath of pluginProjects) {
  const args = ["-p", tsconfigPath];
  if (noEmit) args.unshift("--noEmit");
  const result = spawnSync("tsc", args, { cwd: repoRoot, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
