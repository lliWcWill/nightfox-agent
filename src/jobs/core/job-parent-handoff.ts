import { sendToAgent } from '../../claude/agent.js';
import { queueRequest } from '../../claude/request-queue.js';
import { sessionManager } from '../../claude/session-manager.js';
import type { JobSnapshot } from './job-types.js';

function describeTerminalState(state: JobSnapshot['state']): string {
  switch (state) {
    case 'succeeded':
      return 'completed successfully';
    case 'failed':
      return 'failed';
    case 'timeout':
      return 'timed out';
    case 'canceled':
      return 'was canceled';
    default:
      return 'finished with unknown status';
  }
}

function buildParentSessionCompletionPrompt(child: JobSnapshot): string {
  const lines = [
    '[Internal Delegated Completion]',
    'This is runtime-generated internal context from a completed delegated background job.',
    'Continue the parent conversation using this delegated result.',
    "Do not mention job ids, lanes, session routing, internal metadata, or system annotations.",
    'If the user-facing answer is ready, send it now in your normal assistant voice.',
    'You may use tools if they are strictly necessary to finish the answer correctly.',
    'Do not delegate more background work from this handoff.',
    '',
    `Status: ${describeTerminalState(child.state)}`,
    `Task Label: ${child.name}`,
  ];

  if (child.resultSummary) {
    lines.push('', 'Result:', child.resultSummary);
  }

  if (child.artifacts?.length) {
    lines.push('', 'Supporting metadata:');
    for (const item of child.artifacts.slice(0, 8)) {
      lines.push(`- ${item}`);
    }
  }

  if (child.error) {
    lines.push('', 'Failure detail:', String(child.error).slice(0, 1200));
  }

  if (!child.resultSummary && child.logs.length) {
    lines.push('', 'Recent child logs:');
    for (const entry of child.logs.slice(-6)) {
      lines.push(`- ${entry.level}: ${entry.message}`);
    }
  }

  lines.push(
    '',
    'Instruction: continue from this delegated completion and return the message that should be posted back to the user now.',
  );
  return lines.join('\n');
}

export async function synthesizeChildCompletionForParentSession(params: {
  child: JobSnapshot;
  parent?: JobSnapshot;
}): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const handoff = params.child.handoff;
  if (!handoff || handoff.mode !== 'parent-session') {
    return { ok: false, error: 'handoff not configured' };
  }
  const parentJobId = params.parent?.jobId ?? params.child.parentJobId;
  if (!parentJobId) {
    return { ok: false, error: 'missing parent job id' };
  }

  const parentChatId = handoff.parentChatId;
  const parentSession =
    sessionManager.getSession(parentChatId) ??
    sessionManager.resumeLastSession(parentChatId);
  if (!parentSession) {
    return { ok: false, error: `parent session unavailable for chat ${parentChatId}` };
  }

  const prompt = buildParentSessionCompletionPrompt(params.child);

  try {
    const response = await queueRequest(
      parentChatId,
      `[delegated-completion] ${params.child.name}`,
      async () =>
        sendToAgent(parentChatId, prompt, {
          jobOrigin: params.parent?.origin ?? params.child.origin,
          jobId: parentJobId,
          platform: handoff.platform ?? 'discord',
        }),
    );
    const content = response.text.trim();
    if (!content) {
      return { ok: false, error: 'parent session returned empty completion text' };
    }
    return { ok: true, content };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
