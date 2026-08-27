import type { WorkflowRegistry, WorkflowRegistration } from "./types";

const CANONICAL_PRODUCT_ID_PREFIX = "navoke.";
const LEGACY_BLINK_PRODUCT_ID_PREFIX = "based-blink.";

export function canonicalProductId(id: string): string {
  return id.startsWith(LEGACY_BLINK_PRODUCT_ID_PREFIX)
    ? `${CANONICAL_PRODUCT_ID_PREFIX}${id.slice(LEGACY_BLINK_PRODUCT_ID_PREFIX.length)}`
    : id;
}

export function legacyProductId(id: string): string | undefined {
  return id.startsWith(CANONICAL_PRODUCT_ID_PREFIX)
    ? `${LEGACY_BLINK_PRODUCT_ID_PREFIX}${id.slice(CANONICAL_PRODUCT_ID_PREFIX.length)}`
    : undefined;
}

export function productIdsMatch(left: string, right: string): boolean {
  return canonicalProductId(left) === canonicalProductId(right);
}

export function addLegacyWorkflowAliases(registry: WorkflowRegistry): WorkflowRegistry {
  for (const [workflowId, registration] of [...registry.entries()]) {
    const legacyId = legacyProductId(workflowId);
    if (legacyId && !registry.has(legacyId)) registry.set(legacyId, registration);
  }
  return registry;
}

export function uniqueWorkflowRegistrations(registry: WorkflowRegistry): WorkflowRegistration[] {
  const registrations = new Map<string, WorkflowRegistration>();
  for (const registration of registry.values()) {
    registrations.set(registration.definition.manifest.id, registration);
  }
  return [...registrations.values()];
}
