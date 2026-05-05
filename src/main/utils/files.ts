import fs from "node:fs";
import path from "node:path";
import extractZipPackage from "extract-zip";

export function safeBaseName(filePath: string): string {
  return path.basename(filePath).replace(/[^\w.\- ]+/g, "_");
}

export function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function copyFileToDir(sourcePath: string, targetDir: string, prefix = ""): string {
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, `${prefix}${safeBaseName(sourcePath)}`);
  fs.copyFileSync(sourcePath, target);
  return target;
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function extractZip(zipPath: string, targetDir: string): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true });
  await extractZipPackage(zipPath, { dir: targetDir });
}

export function inferMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png"].includes(ext)) return "image/png";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if ([".webp"].includes(ext)) return "image/webp";
  if ([".gif"].includes(ext)) return "image/gif";
  if ([".glb"].includes(ext)) return "model/gltf-binary";
  if ([".gltf"].includes(ext)) return "model/gltf+json";
  if ([".obj"].includes(ext)) return "model/obj";
  if ([".mtl"].includes(ext)) return "text/plain";
  if ([".json"].includes(ext)) return "application/json";
  if ([".zip"].includes(ext)) return "application/zip";
  return null;
}
