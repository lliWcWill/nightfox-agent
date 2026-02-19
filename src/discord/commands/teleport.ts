import { ChatInputCommandInteraction } from 'discord.js';
import { discordChatId } from '../id-mapper.js';
import { sessionManager } from '../../claude/session-manager.js';
import { config } from '../../config.js';
import path from 'path';

export async function handleTeleport(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordChatId(interaction.channelId);
  const session = sessionManager.getSession(chatId);

  if (!session) {
    await interaction.reply({
      content: 'No active session to teleport.\n\nStart a conversation first with `/project <path>`.',
      ephemeral: true,
    });
    return;
  }

  if (!session.claudeSessionId) {
    await interaction.reply({
      content: 'No Claude session available yet.\n\nSend a message first to start a session, then use `/teleport`.',
      ephemeral: true,
    });
    return;
  }

  const projectName = path.basename(session.workingDirectory);
  const claudeBin = config.CLAUDE_EXECUTABLE_PATH ?? 'claude';
  const command = `cd "${session.workingDirectory}" && ${claudeBin} --resume ${session.claudeSessionId}`;

  await interaction.reply({
    content: [
      '**Teleport to Terminal**',
      '',
      `**Project:** \`${projectName}\``,
      `**Session:** \`${session.claudeSessionId.substring(0, 8)}...\``,
      `**Full ID:** \`${session.claudeSessionId}\``,
      '',
      'Copy and run in your terminal:',
      '```',
      command,
      '```',
      '_Both Discord and terminal can continue independently (forked session)._',
    ].join('\n'),
    ephemeral: true,
  });
}
