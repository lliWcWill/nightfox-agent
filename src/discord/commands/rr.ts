import { ChatInputCommandInteraction } from 'discord.js';
import { jobRunner } from '../../jobs/index.js';
import { prepareMaintenanceJob } from '../../jobs/core/job-definitions.js';
import { postJobStarted } from '../jobs/job-notifier.js';

/**
 * Quick restart command alias for /devops run job:restart-discord-service.
 */
export async function handleRr(interaction: ChatInputCommandInteraction): Promise<void> {
  const origin = {
    guildId: interaction.guildId ?? undefined,
    channelId: interaction.channelId,
    threadId: interaction.channel?.isThread() ? interaction.channelId : undefined,
    userId: interaction.user.id,
  };
  const job = prepareMaintenanceJob({
    job: 'restart-discord-service',
    timeoutMs: 1000 * 60 * 15,
  });

  const jobId = jobRunner.enqueue({
    name: job.name,
    lane: job.lane,
    origin,
    handler: job.handler,
    timeoutMs: job.timeoutMs,
    resumeSpec: job.resumeSpec,
    handoff: job.handoff,
  });

  await postJobStarted(interaction, jobId);
}
