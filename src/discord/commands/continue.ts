import { ChatInputCommandInteraction } from 'discord.js';
import * as path from 'path';
import { discordChatId, discordSessionId } from '../id-mapper.js';
import { sessionManager } from '../../claude/session-manager.js';

/**
 * Continues the invoking user's most recent session and notifies them of the resumed project.
 *
 * If a previous session exists, resumes it and replies ephemerally
 * with the project name, working directory, and a truncated Claude session ID when available.
 * If no previous session exists, replies ephemerally with guidance to start a new session using `/project <path>`.
 *
 * @param interaction - The Discord chat input interaction that triggered the continue command
 */
export async function handleContinue(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordSessionId(interaction.user.id, interaction.channelId);
  const legacyChatId = discordChatId(interaction.user.id);

  try {
    const session = sessionManager.resumeLastSession(chatId)
      ?? (chatId !== legacyChatId ? sessionManager.resumeLastSessionAs(legacyChatId, chatId) : undefined);

    if (!session) {
      await interaction.reply({
        content: 'No previous session to continue.\n\nUse `/project <path>` to start a new session.',
        flags: 64,
      });
      return;
    }

    // IMPORTANT: Do NOT clear conversation on /continue.
    // /continue is meant to restore the user's previous conversation context
    // after a bot restart or interruption.

    const projectName = path.basename(session.workingDirectory);
    let msg = `Continuing **${projectName}**\n\nWorking directory: \`${session.workingDirectory}\``;
    if (session.claudeSessionId) {
      msg += `\nClaude session: \`${session.claudeSessionId.slice(0, 20)}...\``;
    }

    await interaction.reply({ content: msg, flags: 64 });
  } catch (error) {
    console.error('[Continue] Error:', error);
    await interaction.reply({
      content: 'An error occurred while resuming the session.',
      flags: 64,
    }).catch(() => {});
  }
}
