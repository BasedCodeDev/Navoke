import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: websiteDir,
  base: "./",
  build: {
    outDir: path.resolve(websiteDir, "../dist/website"),
    emptyOutDir: true
  }
});
