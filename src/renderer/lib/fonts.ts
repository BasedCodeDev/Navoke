export type FontId = "system" | "inter" | "jetbrains-mono" | "segoe-ui" | "verdana" | "georgia";

export const FONT_STORAGE_KEY = "basedBlinkFont";

export interface FontDefinition {
  id: FontId;
  name: string;
  description: string;
  family: string;
  preview: string;
}

export const appFonts: FontDefinition[] = [
  {
    id: "system",
    name: "System",
    description: "Native platform UI stack.",
    family: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    preview: "Workflow run status"
  },
  {
    id: "inter",
    name: "Inter",
    description: "Current compact sans-serif default.",
    family: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    preview: "Workflow run status"
  },
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    description: "Developer-focused monospace with clear symbols.",
    family: '"JetBrains Mono", "Fira Code", "Cascadia Mono", Consolas, monospace',
    preview: "run.status === completed"
  },
  {
    id: "segoe-ui",
    name: "Segoe UI",
    description: "Windows-native interface font.",
    family: '"Segoe UI", ui-sans-serif, system-ui, sans-serif',
    preview: "Workflow run status"
  },
  {
    id: "verdana",
    name: "Verdana",
    description: "Wide, highly readable sans-serif.",
    family: 'Verdana, Geneva, ui-sans-serif, sans-serif',
    preview: "Workflow run status"
  },
  {
    id: "georgia",
    name: "Georgia",
    description: "Serif option for softer reading.",
    family: 'Georgia, Cambria, "Times New Roman", Times, serif',
    preview: "Workflow run status"
  }
];

const fontsById = new Map<FontId, FontDefinition>(appFonts.map((font) => [font.id, font]));

export function getFontById(id: FontId): FontDefinition {
  return fontsById.get(id) ?? appFonts[0];
}

export function isFontId(value: string | null | undefined): value is FontId {
  return Boolean(value && fontsById.has(value as FontId));
}

export function resolveFontId(storedFont: string | null | undefined): FontId {
  return isFontId(storedFont) ? storedFont : "inter";
}

export function applyFontToRoot(font: FontDefinition, root: HTMLElement = document.documentElement): void {
  root.style.setProperty("--app-font-family", font.family);
  root.dataset.font = font.id;
}
