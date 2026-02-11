import { ChatInputCommandInteraction } from 'discord.js';
import { discordChatId } from '../id-mapper.js';
import { clearConversation } from '../../claude/agent.js';
import { sessionManager } from '../../claude/session-manager.js';

/**
 * Clears the invoking user's conversation history for their current session and notifies them.
 *
 * If no active session exists for the user, replies with "No active session." Otherwise clears
 * the conversation history while keeping the session and project active, and replies with a
 * confirmation message.
 *
 * @param interaction - The command interaction representing the user's request
 */
export async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordChatId(interaction.user.id);

  const session = sessionManager.getSession(chatId);
  if (!session) {
    await interaction.reply({ content: 'No active session.', ephemeral: true });
    return;
  }

  clearConversation(chatId);

  await interaction.reply({
    content: 'Conversation history cleared. Session and project remain active.',
    ephemeral: true,
  });
}