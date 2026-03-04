type ScopeKeyInput = {
  guildId?: string;
  channelId: string;
  threadId?: string;
  userId?: string;
};

function scopeKey(input: ScopeKeyInput): string {
  return [
    input.guildId ?? 'dm',
    input.channelId,
    input.threadId ?? 'no-thread',
    input.userId ?? 'any-user',
  ].join(':');
}

export class ConversationActivityGate {
  private readonly activeWindowMs: number;
  private lastActive = new Map<string, number>();

  constructor(activeWindowMs = 45_000) {
    this.activeWindowMs = activeWindowMs;
  }

  touch(input: ScopeKeyInput, at = Date.now()) {
    this.lastActive.set(scopeKey(input), at);
  }

  isActive(input: ScopeKeyInput, now = Date.now()): boolean {
    const t = this.lastActive.get(scopeKey(input));
    if (!t) return false;
    return now - t < this.activeWindowMs;
  }
}

export const conversationActivityGate = new ConversationActivityGate();

export function markConversationActivity(input: ScopeKeyInput) {
  conversationActivityGate.touch(input);
}
