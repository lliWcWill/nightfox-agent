import { sessionManager } from '../claude/session-manager.js';
import { discordChatId, discordSessionId } from './id-mapper.js';

type SessionSnapshot = Exclude<ReturnType<typeof sessionManager.getSession>, undefined>;

export type ProjectSource = 'scoped' | 'legacy' | 'none';

export interface DiscordSessionLaneState {
  scopedChatId: number;
  legacyChatId: number;
  scopedSession?: SessionSnapshot;
  legacySession?: SessionSnapshot;
  effectiveProjectSession?: SessionSnapshot;
  projectSource: ProjectSource;
}

export function projectSourceLabel(source: ProjectSource): 'scoped' | 'legacy fallback' | 'none' {
  if (source === 'legacy') return 'legacy fallback';
  return source;
}

export function resolveDiscordSessionLane(
  userSnowflake: string,
  channelSnowflake: string,
): DiscordSessionLaneState {
  const scopedChatId = discordSessionId(userSnowflake, channelSnowflake);
  const legacyChatId = discordChatId(userSnowflake);

  const scopedSession = sessionManager.getSession(scopedChatId);
  const legacySession = scopedChatId === legacyChatId
    ? scopedSession
    : sessionManager.getSession(legacyChatId);

  const effectiveProjectSession = scopedSession ?? legacySession;
  const projectSource: ProjectSource = scopedSession
    ? 'scoped'
    : (legacySession ? 'legacy' : 'none');

  return {
    scopedChatId,
    legacyChatId,
    scopedSession,
    legacySession,
    effectiveProjectSession,
    projectSource,
  };
}
