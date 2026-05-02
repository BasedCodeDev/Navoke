export type ThemeId =
  | "light"
  | "dark"
  | "dracula"
  | "one-dark-pro"
  | "tokyo-night"
  | "tokyo-night-oled"
  | "matte-black"
  | "based-code"
  | "kanagawa"
  | "nord"
  | "evergarden"
  | "solarized-dark"
  | "solarized-light"
  | "solarized-osaka";

export type ThemeAppearance = "light" | "dark";

export const THEME_STORAGE_KEY = "basedBlinkTheme";

interface SemanticTone {
  background: string;
  foreground: string;
  border: string;
}

interface ThemeTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  border: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  destructiveForeground: string;
  tones: {
    neutral: SemanticTone;
    info: SemanticTone;
    success: SemanticTone;
    warning: SemanticTone;
    danger: SemanticTone;
    lab: SemanticTone;
  };
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  appearance: ThemeAppearance;
  swatches: string[];
  tokens: ThemeTokens;
}

export const toneClassNames = {
  neutral:
    "border-[hsl(var(--tone-neutral-border))] bg-[hsl(var(--tone-neutral-bg))] text-[hsl(var(--tone-neutral-fg))]",
  info: "border-[hsl(var(--tone-info-border))] bg-[hsl(var(--tone-info-bg))] text-[hsl(var(--tone-info-fg))]",
  success:
    "border-[hsl(var(--tone-success-border))] bg-[hsl(var(--tone-success-bg))] text-[hsl(var(--tone-success-fg))]",
  warning:
    "border-[hsl(var(--tone-warning-border))] bg-[hsl(var(--tone-warning-bg))] text-[hsl(var(--tone-warning-fg))]",
  danger:
    "border-[hsl(var(--tone-danger-border))] bg-[hsl(var(--tone-danger-bg))] text-[hsl(var(--tone-danger-fg))]",
  lab: "border-[hsl(var(--tone-lab-border))] bg-[hsl(var(--tone-lab-bg))] text-[hsl(var(--tone-lab-fg))]"
} as const;

export const toneTextClassNames = {
  danger: "text-[hsl(var(--tone-danger-fg))]",
  success: "text-[hsl(var(--tone-success-fg))]"
} as const;

const lightTones = {
  neutral: { background: "#F1F5F9", foreground: "#334155", border: "#CBD5E1" },
  info: { background: "#E0F2FE", foreground: "#075985", border: "#BAE6FD" },
  success: { background: "#DCFCE7", foreground: "#166534", border: "#BBF7D0" },
  warning: { background: "#FEF3C7", foreground: "#92400E", border: "#FDE68A" },
  danger: { background: "#FEE2E2", foreground: "#991B1B", border: "#FECACA" },
  lab: { background: "#F3E8FF", foreground: "#6B21A8", border: "#E9D5FF" }
};

const darkTones = {
  neutral: { background: "#1E293B", foreground: "#E2E8F0", border: "#334155" },
  info: { background: "#082F49", foreground: "#BAE6FD", border: "#0E7490" },
  success: { background: "#052E16", foreground: "#BBF7D0", border: "#15803D" },
  warning: { background: "#422006", foreground: "#FDE68A", border: "#B45309" },
  danger: { background: "#450A0A", foreground: "#FECACA", border: "#B91C1C" },
  lab: { background: "#2E1065", foreground: "#E9D5FF", border: "#7E22CE" }
};

function darkAccentTones(input: {
  surface: string;
  border: string;
  info: string;
  success: string;
  warning: string;
  danger: string;
  lab: string;
  neutralForeground?: string;
}): ThemeTokens["tones"] {
  return {
    neutral: { background: input.surface, foreground: input.neutralForeground ?? "#F8FAFC", border: input.border },
    info: { background: input.surface, foreground: input.info, border: input.border },
    success: { background: input.surface, foreground: input.success, border: input.border },
    warning: { background: input.surface, foreground: input.warning, border: input.border },
    danger: { background: input.surface, foreground: input.danger, border: input.border },
    lab: { background: input.surface, foreground: input.lab, border: input.border }
  };
}

function lightAccentTones(input: {
  surface: string;
  border: string;
  info: string;
  success: string;
  warning: string;
  danger: string;
  lab: string;
  neutralForeground?: string;
}): ThemeTokens["tones"] {
  return {
    neutral: { background: input.surface, foreground: input.neutralForeground ?? "#0F172A", border: input.border },
    info: { background: input.surface, foreground: input.info, border: input.border },
    success: { background: input.surface, foreground: input.success, border: input.border },
    warning: { background: input.surface, foreground: input.warning, border: input.border },
    danger: { background: input.surface, foreground: input.danger, border: input.border },
    lab: { background: input.surface, foreground: input.lab, border: input.border }
  };
}

export const appThemes: ThemeDefinition[] = [
  {
    id: "light",
    name: "Light",
    description: "Clean light workspace with crisp blue accents.",
    appearance: "light",
    swatches: ["#F8FAFC", "#FFFFFF", "#CBD5E1", "#0369A1", "#0F172A", "#B91C1C"],
    tokens: {
      background: "#F8FAFC",
      foreground: "#0F172A",
      card: "#FFFFFF",
      cardForeground: "#0F172A",
      border: "#CBD5E1",
      muted: "#E2E8F0",
      mutedForeground: "#475569",
      primary: "#0369A1",
      primaryForeground: "#FFFFFF",
      destructive: "#B91C1C",
      destructiveForeground: "#FFFFFF",
      tones: lightTones
    }
  },
  {
    id: "dark",
    name: "Dark",
    description: "Neutral dark workspace tuned for long sessions.",
    appearance: "dark",
    swatches: ["#0F172A", "#111827", "#334155", "#22D3EE", "#F8FAFC", "#F87171"],
    tokens: {
      background: "#0F172A",
      foreground: "#F8FAFC",
      card: "#111827",
      cardForeground: "#F8FAFC",
      border: "#334155",
      muted: "#1E293B",
      mutedForeground: "#CBD5E1",
      primary: "#22D3EE",
      primaryForeground: "#082F49",
      destructive: "#F87171",
      destructiveForeground: "#450A0A",
      tones: darkTones
    }
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "Official Dracula-inspired dark palette with vivid neon accents.",
    appearance: "dark",
    swatches: ["#282A36", "#343746", "#44475A", "#BD93F9", "#FF79C6", "#8BE9FD"],
    tokens: {
      background: "#282A36",
      foreground: "#F8F8F2",
      card: "#343746",
      cardForeground: "#F8F8F2",
      border: "#6272A4",
      muted: "#44475A",
      mutedForeground: "#D6D6E8",
      primary: "#BD93F9",
      primaryForeground: "#191A21",
      destructive: "#FF5555",
      destructiveForeground: "#191A21",
      tones: darkAccentTones({
        surface: "#21222C",
        border: "#6272A4",
        info: "#8BE9FD",
        success: "#50FA7B",
        warning: "#F1FA8C",
        danger: "#FF6E6E",
        lab: "#FF79C6"
      })
    }
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    description: "Balanced Atom and VS Code inspired editor palette.",
    appearance: "dark",
    swatches: ["#282C34", "#3E4451", "#ABB2BF", "#61AFEF", "#C678DD", "#98C379"],
    tokens: {
      background: "#282C34",
      foreground: "#E6E6E6",
      card: "#21252B",
      cardForeground: "#E6E6E6",
      border: "#3E4451",
      muted: "#2C323C",
      mutedForeground: "#C8CDD6",
      primary: "#61AFEF",
      primaryForeground: "#10151C",
      destructive: "#E06C75",
      destructiveForeground: "#10151C",
      tones: darkAccentTones({
        surface: "#21252B",
        border: "#3E4451",
        info: "#61AFEF",
        success: "#98C379",
        warning: "#D19A66",
        danger: "#E06C75",
        lab: "#C678DD",
        neutralForeground: "#D7DAE0"
      })
    }
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Deep blue night palette with bright city accents.",
    appearance: "dark",
    swatches: ["#1A1B26", "#24283B", "#414868", "#7AA2F7", "#BB9AF7", "#7DCFFF"],
    tokens: {
      background: "#1A1B26",
      foreground: "#C0CAF5",
      card: "#24283B",
      cardForeground: "#C0CAF5",
      border: "#414868",
      muted: "#292E42",
      mutedForeground: "#A9B1D6",
      primary: "#7AA2F7",
      primaryForeground: "#11111B",
      destructive: "#F7768E",
      destructiveForeground: "#11111B",
      tones: darkAccentTones({
        surface: "#24283B",
        border: "#414868",
        info: "#7DCFFF",
        success: "#9ECE6A",
        warning: "#E0AF68",
        danger: "#F7768E",
        lab: "#BB9AF7",
        neutralForeground: "#C0CAF5"
      })
    }
  },
  {
    id: "tokyo-night-oled",
    name: "Tokyo Night OLED",
    description: "Tokyo Night accents on true black surfaces.",
    appearance: "dark",
    swatches: ["#000000", "#11111B", "#16161E", "#7AA2F7", "#BB9AF7", "#9ECE6A"],
    tokens: {
      background: "#000000",
      foreground: "#C0CAF5",
      card: "#11111B",
      cardForeground: "#C0CAF5",
      border: "#414868",
      muted: "#16161E",
      mutedForeground: "#A9B1D6",
      primary: "#7AA2F7",
      primaryForeground: "#000000",
      destructive: "#F7768E",
      destructiveForeground: "#000000",
      tones: darkAccentTones({
        surface: "#11111B",
        border: "#414868",
        info: "#7DCFFF",
        success: "#9ECE6A",
        warning: "#E0AF68",
        danger: "#F7768E",
        lab: "#BB9AF7",
        neutralForeground: "#C0CAF5"
      })
    }
  },
  {
    id: "matte-black",
    name: "Matte Black",
    description: "Minimal near-black theme with gray structure and orange accents.",
    appearance: "dark",
    swatches: ["#171717", "#181818", "#313131", "#454545", "#FF7300", "#E8E8E8"],
    tokens: {
      background: "#171717",
      foreground: "#E8E8E8",
      card: "#181818",
      cardForeground: "#E8E8E8",
      border: "#454545",
      muted: "#313131",
      mutedForeground: "#CFCFCF",
      primary: "#FF7300",
      primaryForeground: "#171717",
      destructive: "#FE5800",
      destructiveForeground: "#171717",
      tones: darkAccentTones({
        surface: "#181818",
        border: "#454545",
        info: "#FFB366",
        success: "#B8E986",
        warning: "#FF9900",
        danger: "#FF8A3D",
        lab: "#F0A15E",
        neutralForeground: "#E8E8E8"
      })
    }
  },
  {
    id: "based-code",
    name: "Based Code",
    description: "Slightly lifted matte black surfaces with deep purple accents.",
    appearance: "dark",
    swatches: ["#1D1D20", "#202024", "#38383F", "#50505A", "#5E316D", "#ECE8F0"],
    tokens: {
      background: "#1D1D20",
      foreground: "#ECE8F0",
      card: "#202024",
      cardForeground: "#ECE8F0",
      border: "#50505A",
      muted: "#38383F",
      mutedForeground: "#D8D0DE",
      primary: "#5E316D",
      primaryForeground: "#FFFFFF",
      destructive: "#8A4A9E",
      destructiveForeground: "#FFFFFF",
      tones: darkAccentTones({
        surface: "#202024",
        border: "#50505A",
        info: "#C384D4",
        success: "#A8D990",
        warning: "#D8BE79",
        danger: "#D987E8",
        lab: "#C384D4",
        neutralForeground: "#ECE8F0"
      })
    }
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    description: "Japanese-inspired ink palette with muted blue accents.",
    appearance: "dark",
    swatches: ["#1F1F28", "#2A2A37", "#54546D", "#DCD7BA", "#7E9CD8", "#98BB6C"],
    tokens: {
      background: "#1F1F28",
      foreground: "#DCD7BA",
      card: "#2A2A37",
      cardForeground: "#DCD7BA",
      border: "#54546D",
      muted: "#363646",
      mutedForeground: "#C8C093",
      primary: "#7E9CD8",
      primaryForeground: "#16161D",
      destructive: "#E82424",
      destructiveForeground: "#16161D",
      tones: darkAccentTones({
        surface: "#2A2A37",
        border: "#54546D",
        info: "#7FB4CA",
        success: "#98BB6C",
        warning: "#E6C384",
        danger: "#FF5D62",
        lab: "#957FB8",
        neutralForeground: "#DCD7BA"
      })
    }
  },
  {
    id: "nord",
    name: "Nord",
    description: "Cool arctic blue dark theme with soft contrast.",
    appearance: "dark",
    swatches: ["#2E3440", "#3B4252", "#4C566A", "#D8DEE9", "#88C0D0", "#A3BE8C"],
    tokens: {
      background: "#2E3440",
      foreground: "#ECEFF4",
      card: "#3B4252",
      cardForeground: "#ECEFF4",
      border: "#4C566A",
      muted: "#434C5E",
      mutedForeground: "#D8DEE9",
      primary: "#88C0D0",
      primaryForeground: "#2E3440",
      destructive: "#BF616A",
      destructiveForeground: "#1B2028",
      tones: darkAccentTones({
        surface: "#3B4252",
        border: "#4C566A",
        info: "#88C0D0",
        success: "#A3BE8C",
        warning: "#EBCB8B",
        danger: "#E0838B",
        lab: "#B48EAD",
        neutralForeground: "#ECEFF4"
      })
    }
  },
  {
    id: "evergarden",
    name: "Evergarden",
    description: "Lush green and soft pastel theme for a calmer workspace.",
    appearance: "dark",
    swatches: ["#0E1012", "#1C2420", "#E2E3E4", "#A8C9B0", "#9AE8A8", "#F5D0E3"],
    tokens: {
      background: "#0E1012",
      foreground: "#E2E3E4",
      card: "#15191A",
      cardForeground: "#E2E3E4",
      border: "#34413A",
      muted: "#1C2420",
      mutedForeground: "#B8C7BE",
      primary: "#A8C9B0",
      primaryForeground: "#0E1012",
      destructive: "#F5A0B8",
      destructiveForeground: "#0E1012",
      tones: darkAccentTones({
        surface: "#15191A",
        border: "#34413A",
        info: "#B8F0E0",
        success: "#9AE8A8",
        warning: "#E8D18A",
        danger: "#F5A0B8",
        lab: "#F5D0E3",
        neutralForeground: "#E2E3E4"
      })
    }
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    description: "Classic low-glare Solarized dark palette.",
    appearance: "dark",
    swatches: ["#002B36", "#073642", "#586E75", "#EEE8D5", "#268BD2", "#2AA198"],
    tokens: {
      background: "#002B36",
      foreground: "#EEE8D5",
      card: "#073642",
      cardForeground: "#EEE8D5",
      border: "#586E75",
      muted: "#073642",
      mutedForeground: "#C7D0C0",
      primary: "#268BD2",
      primaryForeground: "#002B36",
      destructive: "#DC322F",
      destructiveForeground: "#002B36",
      tones: darkAccentTones({
        surface: "#073642",
        border: "#586E75",
        info: "#4CB6E8",
        success: "#B4C740",
        warning: "#E7B84A",
        danger: "#F06B68",
        lab: "#A4A8E8",
        neutralForeground: "#EEE8D5"
      })
    }
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Classic Solarized light palette with balanced contrast.",
    appearance: "light",
    swatches: ["#FDF6E3", "#EEE8D5", "#93A1A1", "#002B36", "#268BD2", "#859900"],
    tokens: {
      background: "#FDF6E3",
      foreground: "#002B36",
      card: "#EEE8D5",
      cardForeground: "#002B36",
      border: "#93A1A1",
      muted: "#EEE8D5",
      mutedForeground: "#073642",
      primary: "#268BD2",
      primaryForeground: "#002B36",
      destructive: "#DC322F",
      destructiveForeground: "#FDF6E3",
      tones: lightAccentTones({
        surface: "#EEE8D5",
        border: "#93A1A1",
        info: "#075985",
        success: "#566600",
        warning: "#7A5A00",
        danger: "#9F1F1C",
        lab: "#4E55A6",
        neutralForeground: "#002B36"
      })
    }
  },
  {
    id: "solarized-osaka",
    name: "Solarized Osaka",
    description: "Osaka-inspired Solarized variant with deeper blue surfaces.",
    appearance: "dark",
    swatches: ["#222334", "#1B1C29", "#454970", "#CAD2F2", "#8AA8F8", "#CAE697"],
    tokens: {
      background: "#222334",
      foreground: "#CAD2F2",
      card: "#1B1C29",
      cardForeground: "#CAD2F2",
      border: "#454970",
      muted: "#303E72",
      mutedForeground: "#CAD2F2",
      primary: "#8AA8F8",
      primaryForeground: "#1B1C29",
      destructive: "#ED7D81",
      destructiveForeground: "#1B1C29",
      tones: darkAccentTones({
        surface: "#1B1C29",
        border: "#454970",
        info: "#9BDEF8",
        success: "#CAE697",
        warning: "#F6C982",
        danger: "#ED7D81",
        lab: "#B99AF8",
        neutralForeground: "#CAD2F2"
      })
    }
  }
];

const themesById = new Map<ThemeId, ThemeDefinition>(appThemes.map((theme) => [theme.id, theme]));

export function getThemeById(id: ThemeId): ThemeDefinition {
  return themesById.get(id) ?? appThemes[0];
}

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return Boolean(value && themesById.has(value as ThemeId));
}

export function resolveThemeId(storedTheme: string | null | undefined, prefersDark: boolean): ThemeId {
  if (storedTheme === "matte-purple") return "based-code";
  if (isThemeId(storedTheme)) return storedTheme;
  return prefersDark ? "dark" : "light";
}

export function applyThemeToRoot(theme: ThemeDefinition, root: HTMLElement = document.documentElement): void {
  const variables: Record<string, string> = {
    background: theme.tokens.background,
    foreground: theme.tokens.foreground,
    card: theme.tokens.card,
    "card-foreground": theme.tokens.cardForeground,
    border: theme.tokens.border,
    muted: theme.tokens.muted,
    "muted-foreground": theme.tokens.mutedForeground,
    primary: theme.tokens.primary,
    "primary-foreground": theme.tokens.primaryForeground,
    destructive: theme.tokens.destructive,
    "destructive-foreground": theme.tokens.destructiveForeground
  };

  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(`--${name}`, hexToHslParts(value));
  }

  for (const [name, tone] of Object.entries(theme.tokens.tones)) {
    root.style.setProperty(`--tone-${name}-bg`, hexToHslParts(tone.background));
    root.style.setProperty(`--tone-${name}-fg`, hexToHslParts(tone.foreground));
    root.style.setProperty(`--tone-${name}-border`, hexToHslParts(tone.border));
  }

  root.dataset.theme = theme.id;
  root.classList.toggle("dark", theme.appearance === "dark");
  root.style.colorScheme = theme.appearance;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(hexToRgb(foreground));
  const backgroundLuminance = relativeLuminance(hexToRgb(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToHslParts(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return `0 0% ${formatPercent(lightness)}`;
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  return `${hue} ${formatPercent(saturation)} ${formatPercent(lightness)}`;
}

function formatPercent(value: number): string {
  return `${Number((value * 100).toFixed(1))}%`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const [red, green, blue] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
