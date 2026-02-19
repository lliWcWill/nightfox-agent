import { ChatInputCommandInteraction } from 'discord.js';
import { discordChatId } from '../id-mapper.js';
import { sessionManager } from '../../claude/session-manager.js';
import { config } from '../../config.js';
import path from 'path';

export async function handleTeleport(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordChatId(interaction.user.id);

  // Try active in-memory session first, then fall back to most recent from history
  let session = sessionManager.getSession(chatId);
  if (!session) {
    session = sessionManager.resumeLastSession(chatId) ?? undefined;
  }

  if (!session) {
    await interaction.reply({
      content: 'No session found — not even in history.\n\nStart a conversation first with `/project <path>`.',
      ephemeral: true,
    });
    return;
  }

  const projectName = path.basename(session.workingDirectory);
  const claudeBin = config.CLAUDE_EXECUTABLE_PATH ?? 'claude';

  if (!session.claudeSessionId) {
    // Session exists but no Claude session ID yet — still show what we have
    await interaction.reply({
      content: [
        '**Teleport — Session Found (no Claude ID yet)**',
        '',
        `**Project:** \`${projectName}\``,
        `**Working dir:** \`${session.workingDirectory}\``,
        `**Conversation:** \`${session.conversationId}\``,
        '',
        'No Claude session ID yet — send a message first, then `/teleport` again.',
        'Or start fresh in your terminal:',
        '```',
        `cd "${session.workingDirectory}" && ${claudeBin}`,
        '```',
      ].join('\n'),
      ephemeral: true,
    });
    return;
  }

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
