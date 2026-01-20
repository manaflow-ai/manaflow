const manualUnreadConversations = new Set<string>();

export function markConversationManualUnread(conversationId: string): void {
  manualUnreadConversations.add(conversationId);
}

export function clearConversationManualUnread(conversationId: string): void {
  manualUnreadConversations.delete(conversationId);
}

export function isConversationManualUnread(conversationId: string): boolean {
  return manualUnreadConversations.has(conversationId);
}
