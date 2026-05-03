export function resolveChatGptTabSelection(
  current: string,
  compatibleClientIds: string[],
  newChatGptTabValue: string
): string {
  if (current === newChatGptTabValue) return current;
  if (current && compatibleClientIds.includes(current)) return current;
  return newChatGptTabValue;
}
