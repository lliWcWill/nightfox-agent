import { AsyncLocalStorage } from 'node:async_hooks';

type ToolContext = {
  chatId: number;
};

const toolContextStore = new AsyncLocalStorage<ToolContext>();

export async function runWithToolContext<T>(ctx: ToolContext, fn: () => Promise<T>): Promise<T> {
  return toolContextStore.run(ctx, fn);
}

export function getCurrentToolChatId(): number | undefined {
  return toolContextStore.getStore()?.chatId;
}
