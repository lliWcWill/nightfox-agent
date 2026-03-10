import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nightfox-lane-home-'));
process.env.HOME = testHome;

test('status lane resolution falls back to legacy project while keeping scoped lane id', async () => {
  const { sessionManager } = await import('../claude/session-manager.js');
  const { sessionHistory } = await import('../claude/session-history.js');
  const {
    resolveDiscordSessionLane,
    projectSourceLabel,
  } = await import('./session-lane.js');

  const userId = '111111111111111111';
  const channelId = '222222222222222222';
  const legacyProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightfox-legacy-project-'));

  const lane = resolveDiscordSessionLane(userId, channelId);

  sessionManager.clearSession(lane.legacyChatId);
  sessionManager.clearSession(lane.scopedChatId);
  sessionHistory.clearHistory(lane.legacyChatId);
  sessionHistory.clearHistory(lane.scopedChatId);

  sessionManager.createSession(lane.legacyChatId, legacyProjectDir);

  const resolved = resolveDiscordSessionLane(userId, channelId);

  assert.equal(resolved.projectSource, 'legacy');
  assert.equal(projectSourceLabel(resolved.projectSource), 'legacy fallback');
  assert.equal(resolved.effectiveProjectSession?.workingDirectory, legacyProjectDir);
  assert.equal(resolved.scopedChatId, lane.scopedChatId);
  assert.equal(resolved.legacyChatId, lane.legacyChatId);
});

test('status lane resolution reports none when no project binding exists', async () => {
  const { sessionManager } = await import('../claude/session-manager.js');
  const { sessionHistory } = await import('../claude/session-history.js');
  const {
    resolveDiscordSessionLane,
    projectSourceLabel,
  } = await import('./session-lane.js');

  const userId = '333333333333333333';
  const channelId = '444444444444444444';
  const lane = resolveDiscordSessionLane(userId, channelId);

  sessionManager.clearSession(lane.legacyChatId);
  sessionManager.clearSession(lane.scopedChatId);
  sessionHistory.clearHistory(lane.legacyChatId);
  sessionHistory.clearHistory(lane.scopedChatId);

  const resolved = resolveDiscordSessionLane(userId, channelId);
  assert.equal(resolved.projectSource, 'none');
  assert.equal(projectSourceLabel(resolved.projectSource), 'none');
  assert.equal(resolved.effectiveProjectSession, undefined);
});
