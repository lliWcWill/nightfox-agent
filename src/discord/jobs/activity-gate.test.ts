import { ConversationActivityGate } from './activity-gate.js';

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg);
}

// Tiny runtime smoke test (manual import/run if needed)
export function runActivityGateSmoke() {
  const gate = new ConversationActivityGate(1000);
  const scope = { guildId: 'g', channelId: 'c', threadId: 't', userId: 'u' };
  assert(gate.isActive(scope) === false, 'expected initially idle');
  gate.touch(scope, 1_000);
  assert(gate.isActive(scope, 1_500) === true, 'expected active window');
  assert(gate.isActive(scope, 2_500) === false, 'expected idle after window');
  return 'ok';
}
