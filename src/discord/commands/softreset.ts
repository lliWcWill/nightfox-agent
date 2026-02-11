import { ChatInputCommandInteraction } from 'discord.js';
import { discordChatId } from '../id-mapper.js';
import { clearConversation } from '../../claude/agent.js';
import { sessionManager } from '../../claude/session-manager.js';
import { resetRequest, clearQueue } from '../../claude/request-queue.js';

/**
 * Perform a soft reset of the invoking user's AI session and confirm with an ephemeral reply.
 *
 * Resets any pending request state, clears the request queue and conversation context, clears the in-memory session for the mapped chat ID, and replies to the interaction with a confirmation message.
 *
 * @param interaction - The Discord chat input interaction that triggered the command
 */
export async function handleSoftReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordChatId(interaction.user.id);

  await resetRequest(chatId);
  clearQueue(chatId);
  clearConversation(chatId);
  sessionManager.clearSession(chatId);

  await interaction.reply({ content: 'Session reset. Use `/project` to start a new session.', ephemeral: true });
}