export function resolveExtensionTabSelection(
  current: string,
  compatibleClientIds: string[],
  newExtensionTabValue: string
): string {
  if (current === newExtensionTabValue) return current;
  if (current && compatibleClientIds.includes(current)) return current;
  return newExtensionTabValue;
}
