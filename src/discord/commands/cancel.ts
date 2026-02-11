import { ChatInputCommandInteraction } from 'discord.js';
import { discordChatId } from '../id-mapper.js';
import {
  cancelRequest,
  clearQueue,
  isProcessing,
} from '../../claude/request-queue.js';

/**
 * Handle a slash command interaction to cancel the user's active request and clear queued requests.
 *
 * If a request was cancelled or queued items were cleared, replies ephemerally with "Cancelled."
 * and appends the number of cleared queued requests when applicable. If nothing was active or queued,
 * replies ephemerally with "Nothing to cancel." If a cancel signal was sent but no immediate
 * cancellation or queue clearance occurred, replies ephemerally with "Cancel sent."
 *
 * @param interaction - The Discord command interaction to respond to
 */
export async function handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordChatId(interaction.user.id);

  const wasProcessing = isProcessing(chatId);
  const cancelled = await cancelRequest(chatId);
  const clearedCount = clearQueue(chatId);

  if (cancelled || clearedCount > 0) {
    let message = 'Cancelled.';
    if (clearedCount > 0) {
      message += ` (${clearedCount} queued request${clearedCount > 1 ? 's' : ''} cleared)`;
    }
    await interaction.reply({ content: message, ephemeral: true });
  } else if (!wasProcessing) {
    await interaction.reply({ content: 'Nothing to cancel.', ephemeral: true });
  } else {
    await interaction.reply({ content: 'Cancel sent.', ephemeral: true });
  }
}