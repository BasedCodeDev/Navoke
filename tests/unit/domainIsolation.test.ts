import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");

describe("core domain isolation", () => {
  it("keeps vendor-specific automation knowledge out of core source and generic tests", () => {
    const targets = [
      path.join(repoRoot, "src"),
      path.join(repoRoot, "extension"),
      path.join(repoRoot, "scripts"),
      path.join(repoRoot, "tests", "unit"),
      path.join(repoRoot, "package.json"),
      path.join(repoRoot, "vitest.config.ts")
    ];
    const content = targets.flatMap(readTextFiles).map((file) => file.content).join("\n");
    const blockedPatterns = [
      `${"chat"}${"gpt"}`,
      `${"hun"}${"yuan"}`,
      `${"open"}${"ai"}`,
      `${"ten"}${"cent"}`,
      `${"reference"}Images`,
      `${"subject"}Images`,
      `${"source"}Images`,
      `${"front"}Image`,
      `${"back"}Image`,
      `${"master"}Prompt`,
      `${"subject"}Instruction`
    ];

    expect(content).not.toMatch(new RegExp(blockedPatterns.join("|"), "i"));
  });
});

function readTextFiles(target: string): Array<{ filePath: string; content: string }> {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [{ filePath: target, content: fs.readFileSync(target, "utf8") }];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const childPath = path.join(target, entry.name);
    if (entry.isDirectory()) return readTextFiles(childPath);
    if (!entry.isFile() || !isTextFile(entry.name)) return [];
    return [{ filePath: childPath, content: fs.readFileSync(childPath, "utf8") }];
  });
}

function isTextFile(fileName: string): boolean {
  return /\.(?:ts|tsx|js|cjs|json|html|css)$/.test(fileName);
}
