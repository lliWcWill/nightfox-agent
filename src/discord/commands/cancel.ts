import { ChatInputCommandInteraction } from 'discord.js';
import { discordChatId, discordSessionId } from '../id-mapper.js';
import { cancelChatOperations } from '../../cancel/cancellation-coordinator.js';

/**
 * Handle a slash command interaction to cancel the user's active request and clear queued requests.
 *
 * Extends cancellation beyond the interactive Claude request queue to include background jobs and
 * active autonomy objectives tied to the same Discord session/origin.
 *
 * @param interaction - The Discord command interaction to respond to
 */
export async function handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  const sessionChatId = discordSessionId(interaction.user.id, interaction.channelId);
  const legacyChatId = discordChatId(interaction.user.id);
  const chatIds = sessionChatId === legacyChatId
    ? [sessionChatId]
    : [sessionChatId, legacyChatId];

  const result = await cancelChatOperations({
    chatIds,
    origin: {
      channelId: interaction.channelId,
      threadId: interaction.channel?.isThread() ? interaction.channelId : undefined,
      userId: interaction.user.id,
    },
  });

  const didAnything = result.cancelledRequests
    || result.clearedQueuedRequests > 0
    || result.cancelledJobs.length > 0
    || result.cancelledObjectives.length > 0;

  if (didAnything) {
    const details: string[] = [];
    if (result.clearedQueuedRequests > 0) {
      details.push(`${result.clearedQueuedRequests} queued request${result.clearedQueuedRequests > 1 ? 's' : ''} cleared`);
    }
    if (result.cancelledJobs.length > 0) {
      details.push(`${result.cancelledJobs.length} background job${result.cancelledJobs.length > 1 ? 's' : ''} cancelled`);
    }
    if (result.cancelledObjectives.length > 0) {
      details.push(`${result.cancelledObjectives.length} objective${result.cancelledObjectives.length > 1 ? 's' : ''} cancelled`);
    }
    const suffix = details.length ? ` (${details.join('; ')})` : '';
    await interaction.reply({ content: `Cancelled.${suffix}`, ephemeral: true });
    return;
  }

  if (!result.hadProcessing) {
    await interaction.reply({ content: 'Nothing to cancel.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: 'Cancel sent.', ephemeral: true });
}
