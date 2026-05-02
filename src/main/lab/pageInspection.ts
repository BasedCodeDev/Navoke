import { createHash } from "node:crypto";

export interface LabRawDomNode {
  tagName: string;
  text?: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  testId?: string;
  href?: string;
  src?: string;
  children?: LabRawDomNode[];
}

export interface LabRawInteractiveElement {
  tagName: string;
  text?: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  visible?: boolean;
  attributes?: Record<string, string>;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface LabRawPageState {
  url: string;
  title: string;
  capturedAt: string;
  viewport: {
    width: number;
    height: number;
  };
  bodyText: string;
  imageFingerprints: string[];
  dom: LabRawDomNode | null;
  interactiveElements: LabRawInteractiveElement[];
}

export interface LabSelectorCandidate {
  selector: string;
  engine: "css" | "text" | "role";
  source: string;
  confidence: number;
}

export interface LabSimplifiedDomNode {
  tagName: string;
  text?: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  testId?: string;
  href?: string;
  src?: string;
  children?: LabSimplifiedDomNode[];
}

export interface LabInteractiveElement {
  index: number;
  tagName: string;
  label: string;
  text: string;
  role?: string;
  ariaLabel?: string;
  type?: string;
  disabled: boolean;
  visible: boolean;
  attributes: Record<string, string>;
  bounds?: LabRawInteractiveElement["bounds"];
  selectors: LabSelectorCandidate[];
}

export interface LabInspectionModel {
  url: string;
  title: string;
  capturedAt: string;
  viewport: LabRawPageState["viewport"];
  bodyTextSample: string;
  bodyTextLength: number;
  fingerprint: string;
  imageFingerprints: string[];
  dom: LabSimplifiedDomNode | null;
  interactiveElements: LabInteractiveElement[];
}

export interface DomSanitizeOptions {
  maxDepth?: number;
  maxChildrenPerNode?: number;
  maxTextLength?: number;
  maxNodes?: number;
}

const DEFAULT_SANITIZE_OPTIONS: Required<DomSanitizeOptions> = {
  maxDepth: 5,
  maxChildrenPerNode: 30,
  maxTextLength: 180,
  maxNodes: 700
};

const INTERACTIVE_TAGS = new Set(["button", "input", "textarea", "select", "a", "summary"]);

export function sanitizeText(value: unknown, maxLength = 180): string {
  if (typeof value !== "string") return "";
  const collapsed = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function sanitizeDomSnapshot(
  node: LabRawDomNode | null | undefined,
  options: DomSanitizeOptions = {}
): LabSimplifiedDomNode | null {
  if (!node) return null;

  const resolved = { ...DEFAULT_SANITIZE_OPTIONS, ...options };
  let seenNodes = 0;

  function visit(current: LabRawDomNode, depth: number): LabSimplifiedDomNode | null {
    if (seenNodes >= resolved.maxNodes || depth > resolved.maxDepth) return null;
    seenNodes += 1;

    const tagName = sanitizeText(current.tagName, 48).toLowerCase();
    if (!tagName || ["script", "style", "noscript", "template", "svg"].includes(tagName)) return null;

    const result: LabSimplifiedDomNode = { tagName };
    assignIfPresent(result, "text", sanitizeText(current.text, resolved.maxTextLength));
    assignIfPresent(result, "id", sanitizeText(current.id, 80));
    assignIfPresent(result, "className", sanitizeText(current.className, 160));
    assignIfPresent(result, "role", sanitizeText(current.role, 80));
    assignIfPresent(result, "ariaLabel", sanitizeText(current.ariaLabel, resolved.maxTextLength));
    assignIfPresent(result, "name", sanitizeText(current.name, 80));
    assignIfPresent(result, "type", sanitizeText(current.type, 40));
    assignIfPresent(result, "placeholder", sanitizeText(current.placeholder, resolved.maxTextLength));
    assignIfPresent(result, "testId", sanitizeText(current.testId, 120));
    assignIfPresent(result, "href", sanitizeText(current.href, 200));
    assignIfPresent(result, "src", sanitizeText(current.src, 200));

    const children = (current.children ?? [])
      .slice(0, resolved.maxChildrenPerNode)
      .map((child) => visit(child, depth + 1))
      .filter((child): child is LabSimplifiedDomNode => Boolean(child));

    if (children.length > 0) {
      result.children = children;
    }

    return result;
  }

  return visit(node, 0);
}

export function buildSelectorCandidates(element: LabRawInteractiveElement): LabSelectorCandidate[] {
  const candidates: LabSelectorCandidate[] = [];
  const tagName = sanitizeText(element.tagName, 48).toLowerCase() || "*";
  const attrs = element.attributes ?? {};

  const id = sanitizeText(element.id ?? attrs.id, 120);
  if (id) {
    candidates.push({ selector: `#${cssIdentifier(id)}`, engine: "css", source: "id", confidence: 0.98 });
  }

  for (const attrName of ["data-testid", "data-test", "data-cy", "data-qa"]) {
    const value = sanitizeText(attrs[attrName], 160);
    if (value) {
      candidates.push({
        selector: `[${attrName}="${cssString(value)}"]`,
        engine: "css",
        source: attrName,
        confidence: 0.95
      });
    }
  }

  const ariaLabel = sanitizeText(element.ariaLabel ?? attrs["aria-label"], 160);
  if (ariaLabel) {
    candidates.push({
      selector: `${tagName}[aria-label="${cssString(ariaLabel)}"]`,
      engine: "css",
      source: "aria-label",
      confidence: 0.88
    });
  }

  const name = sanitizeText(element.name ?? attrs.name, 120);
  if (name) {
    candidates.push({
      selector: `${tagName}[name="${cssString(name)}"]`,
      engine: "css",
      source: "name",
      confidence: 0.84
    });
  }

  const type = sanitizeText(element.type ?? attrs.type, 80);
  if (type && tagName !== "*") {
    candidates.push({
      selector: `${tagName}[type="${cssString(type)}"]`,
      engine: "css",
      source: "type",
      confidence: type === "file" ? 0.82 : 0.64
    });
  }

  const placeholder = sanitizeText(element.placeholder ?? attrs.placeholder, 160);
  if (placeholder) {
    candidates.push({
      selector: `${tagName}[placeholder="${cssString(placeholder)}"]`,
      engine: "css",
      source: "placeholder",
      confidence: 0.78
    });
  }

  const role = sanitizeText(element.role ?? attrs.role, 80);
  const label = bestElementLabel(element);
  if (role && label) {
    candidates.push({
      selector: `${role}[name="${label}"]`,
      engine: "role",
      source: "role+name",
      confidence: 0.8
    });
  }

  if (label && ["button", "a", "summary"].includes(tagName)) {
    candidates.push({
      selector: label,
      engine: "text",
      source: "visible-text",
      confidence: 0.58
    });
  }

  if (tagName !== "*" && INTERACTIVE_TAGS.has(tagName)) {
    const classSelector = firstStableClass(element.className ?? attrs.class);
    if (classSelector) {
      candidates.push({
        selector: `${tagName}.${classSelector}`,
        engine: "css",
        source: "class",
        confidence: 0.45
      });
    }
    candidates.push({
      selector: tagName,
      engine: "css",
      source: "tag",
      confidence: 0.2
    });
  }

  return dedupeSelectors(candidates).sort((a, b) => b.confidence - a.confidence);
}

export function buildInteractiveElements(elements: LabRawInteractiveElement[]): LabInteractiveElement[] {
  return elements.map((element, index) => {
    const text = sanitizeText(element.text, 180);
    const ariaLabel = sanitizeText(element.ariaLabel ?? element.attributes?.["aria-label"], 180);
    const label = bestElementLabel(element) || `${sanitizeText(element.tagName, 48).toLowerCase()} ${index + 1}`;
    return {
      index,
      tagName: sanitizeText(element.tagName, 48).toLowerCase(),
      label,
      text,
      ...(element.role ? { role: sanitizeText(element.role, 80) } : {}),
      ...(ariaLabel ? { ariaLabel } : {}),
      ...(element.type ? { type: sanitizeText(element.type, 60) } : {}),
      disabled: Boolean(element.disabled),
      visible: element.visible !== false,
      attributes: sanitizeAttributes(element.attributes ?? {}),
      ...(element.bounds ? { bounds: element.bounds } : {}),
      selectors: buildSelectorCandidates(element)
    };
  });
}

export function buildInspectionModel(raw: LabRawPageState): LabInspectionModel {
  const bodyText = sanitizeText(raw.bodyText, 1_200);
  return {
    url: raw.url,
    title: sanitizeText(raw.title, 220),
    capturedAt: raw.capturedAt,
    viewport: raw.viewport,
    bodyTextSample: bodyText,
    bodyTextLength: raw.bodyText.length,
    fingerprint: fingerprintPage(raw),
    imageFingerprints: [...new Set(raw.imageFingerprints)].sort(),
    dom: sanitizeDomSnapshot(raw.dom),
    interactiveElements: buildInteractiveElements(raw.interactiveElements)
  };
}

export function fingerprintPage(raw: Pick<LabRawPageState, "url" | "title" | "bodyText" | "imageFingerprints">): string {
  const digest = createHash("sha256");
  digest.update(raw.url);
  digest.update("\n");
  digest.update(raw.title);
  digest.update("\n");
  digest.update(sanitizeText(raw.bodyText, 4_000));
  digest.update("\n");
  digest.update([...new Set(raw.imageFingerprints)].sort().join("\n"));
  return digest.digest("hex").slice(0, 16);
}

function assignIfPresent<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | ""): void {
  if (typeof value === "string" && value.length === 0) return;
  target[key] = value as T[K];
}

function bestElementLabel(element: LabRawInteractiveElement): string {
  return (
    sanitizeText(element.ariaLabel ?? element.attributes?.["aria-label"], 140) ||
    sanitizeText(element.text, 140) ||
    sanitizeText(element.placeholder ?? element.attributes?.placeholder, 140) ||
    sanitizeText(element.name ?? element.attributes?.name, 140) ||
    sanitizeText(element.id ?? element.attributes?.id, 140)
  );
}

function sanitizeAttributes(attributes: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!isUsefulAttribute(key)) continue;
    result[key] = sanitizeText(value, 180);
  }
  return result;
}

function isUsefulAttribute(name: string): boolean {
  return (
    name === "id" ||
    name === "class" ||
    name === "role" ||
    name === "name" ||
    name === "type" ||
    name === "placeholder" ||
    name === "href" ||
    name === "src" ||
    name === "aria-label" ||
    name.startsWith("data-")
  );
}

function firstStableClass(className: string | undefined): string | null {
  const classes = sanitizeText(className, 240)
    .split(" ")
    .map((value) => value.trim())
    .filter(Boolean);
  const stable = classes.find((value) => /^[a-zA-Z][\w-]{2,}$/.test(value) && !/^\d|^css-|^sc-|[0-9a-f]{6,}/i.test(value));
  return stable ? cssIdentifier(stable) : null;
}

function dedupeSelectors(candidates: LabSelectorCandidate[]): LabSelectorCandidate[] {
  const seen = new Set<string>();
  const result: LabSelectorCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.engine}:${candidate.selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function cssIdentifier(value: string): string {
  if (/^-?[_a-zA-Z][\w-]*$/.test(value)) return value;
  return value.replace(/[^_a-zA-Z0-9-]/g, (char) => `\\${char}`);
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
