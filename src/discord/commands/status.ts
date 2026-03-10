import { ChatInputCommandInteraction } from 'discord.js';
import { projectSourceLabel, resolveDiscordSessionLane } from '../session-lane.js';
import { getModel, getCachedUsage, isDangerousMode } from '../../claude/agent.js';
import { isProcessing } from '../../claude/request-queue.js';
import { config } from '../../config.js';
import { jobRunner } from '../../jobs/index.js';
import { buildStatusMessage } from './status-view.js';

/**
 * Sends a concise status summary of the bot and the user's current session to the invoking Discord interaction.
 *
 * The reply includes the project path, active model, processing state, dangerous mode flag, optional Claude session ID,
 * and—when available—usage metrics (total/context tokens with percentage, cost, and turns). If no session exists, a
 * short instruction for starting a project is returned. The reply is sent as an ephemeral message to the command caller.
 *
 * @param interaction - The Discord ChatInputCommandInteraction that triggered the status command
 */
export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const lane = resolveDiscordSessionLane(interaction.user.id, interaction.channelId);
  const scopedChatId = lane.scopedChatId;

  const model = getModel(scopedChatId);
  const processing = isProcessing(scopedChatId);
  const dangerous = isDangerousMode();
  const usage = getCachedUsage(scopedChatId);

  const recentJobs = jobRunner.listRecent(5);
  const running = recentJobs.filter(j => j.state === 'running').length;
  const queued = recentJobs.filter(j => j.state === 'queued').length;
  const lanes = Array.from(new Set(recentJobs.map((j) => j.lane))).join(', ');

  const content = buildStatusMessage({
    projectPath: lane.effectiveProjectSession?.workingDirectory,
    projectSourceLabel: projectSourceLabel(lane.projectSource),
    provider: config.AGENT_PROVIDER,
    model,
    processing,
    dangerous,
    recentJobs: {
      running,
      queued,
      total: recentJobs.length,
      lanes,
    },
    scopedClaudeSessionId: lane.scopedSession?.claudeSessionId,
    usage,
  });

  await interaction.reply({ content, flags: 64 });
}
