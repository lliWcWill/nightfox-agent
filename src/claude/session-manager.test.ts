import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const originalHome = process.env.HOME;
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nightfox-session-home-'));
process.env.HOME = testHome;

test.after(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  fs.rmSync(testHome, { recursive: true, force: true });
});

test('seedWorkingDirectoryFromSession copies only workingDirectory into target lane', async () => {
  const { sessionManager } = await import('./session-manager.js');
  const { sessionHistory } = await import('./session-history.js');

  const sourceChatId = -1001;
  const targetChatId = -2002;

  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightfox-source-project-'));

  sessionManager.clearSession(sourceChatId);
  sessionManager.clearSession(targetChatId);
  sessionHistory.clearHistory(sourceChatId);
  sessionHistory.clearHistory(targetChatId);

  const source = sessionManager.createSession(sourceChatId, sourceDir);
  sessionManager.setClaudeSessionId(sourceChatId, 'claude-source-session');
  sessionManager.setOpenAIConversationId(sourceChatId, 'openai-source-session');

  const seeded = sessionManager.seedWorkingDirectoryFromSession(sourceChatId, targetChatId);
  const target = sessionManager.getSession(targetChatId);

  assert.ok(seeded, 'expected scoped lane to be seeded from legacy lane');
  assert.ok(target, 'expected target scoped session to exist after seeding');
  assert.equal(target?.workingDirectory, sourceDir);
  assert.notEqual(target?.conversationId, source.conversationId);
  assert.equal(target?.claudeSessionId, undefined);
  assert.equal(target?.openaiConversationId, undefined);
});
