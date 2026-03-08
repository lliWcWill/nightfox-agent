import {
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ButtonInteraction,
  ComponentType,
} from 'discord.js';
import * as path from 'path';
import { discordChatId, discordSessionId } from '../id-mapper.js';
import { sessionManager } from '../../claude/session-manager.js';

const COLLECTOR_TIMEOUT_MS = 60_000;

/**
 * Formats a past Date as a concise relative time string.
 *
 * @param date - The past date to compare with the current time
 * @returns `'just now'` if less than 60 seconds, `'<Nm ago>'` if less than 60 minutes, `'<Nh ago>'` if less than 24 hours, otherwise `'<Nd ago>'`
 */
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Presents the user with a list of recent resumable sessions and lets them select one to resume.
 *
 * Displays up to five sessions that have a Claude session ID as buttons, collects the user's selection,
 * resumes the chosen session, clears the current conversation state, and updates the reply with resumed
 * session details. If no resumable sessions exist, replies ephemerally with guidance; if the selection
 * times out, disables the buttons.
 *
 * @param interaction - The command interaction used to send the session list and receive button interactions
 */
export async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordSessionId(interaction.user.id, interaction.channelId);
  const legacyChatId = discordChatId(interaction.user.id);

  const history = sessionManager.getSessionHistory(chatId, 5);
  const historySourceChatId = history.length > 0 || chatId === legacyChatId ? chatId : legacyChatId;
  const effectiveHistory = history.length > 0 || chatId === legacyChatId
    ? history
    : sessionManager.getSessionHistory(legacyChatId, 5);
  const resumable = effectiveHistory.filter((entry) => entry.claudeSessionId);

  if (resumable.length === 0) {
    await interaction.reply({
      content: 'No resumable sessions found.\n\nSessions need at least one Claude response to be resumable.\nUse `/project <path>` to start a new session.',
      flags: 64,
    });
    return;
  }

  // Build one button per resumable session (max 5 buttons per row)
  const buttons = resumable.map((entry, i) => {
    const timeAgo = formatTimeAgo(new Date(entry.lastActivity));
    return new ButtonBuilder()
      .setCustomId(`resume-${i}`)
      .setLabel(`${entry.projectName} (${timeAgo})`)
      .setStyle(ButtonStyle.Primary);
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

  const response = await interaction.reply({
    content: '**Recent Sessions**\n\nSelect a session to resume:',
    components: [row],
    fetchReply: true,
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: COLLECTOR_TIMEOUT_MS,
  });

  let handled = false;

  collector.on('collect', async (i: ButtonInteraction) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: 'Only the command author can use these buttons.', flags: 64 });
      return;
    }

    if (handled) return;
    handled = true;

    const index = parseInt(i.customId.replace('resume-', ''), 10);
    if (Number.isNaN(index) || index < 0 || index >= resumable.length) {
      await i.update({ content: 'Invalid session index.', components: [] });
      collector.stop();
      return;
    }
    const entry = resumable[index];
    if (!entry) {
      await i.update({ content: 'Session not found.', components: [] });
      collector.stop();
      return;
    }

      const session = historySourceChatId === chatId
        ? sessionManager.resumeSession(chatId, entry.conversationId)
        : sessionManager.resumeSessionAs(historySourceChatId, entry.conversationId, chatId);
    if (!session) {
      await i.update({ content: 'Failed to resume session.', components: [] });
      collector.stop();
      return;
    }

    // IMPORTANT: Do NOT clear conversation on /resume.
    // /resume is meant to restore a previous session's context.

    const projectName = path.basename(session.workingDirectory);
    let msg = `Resumed **${projectName}**\n\nWorking directory: \`${session.workingDirectory}\``;
    if (session.claudeSessionId) {
      msg += `\nClaude session: \`${session.claudeSessionId.slice(0, 20)}...\``;
    }

    await i.update({ content: msg, components: [] });
    collector.stop();
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'time' && !handled) {
      const disabledButtons = resumable.map((entry, i) => {
        const timeAgo = formatTimeAgo(new Date(entry.lastActivity));
        return new ButtonBuilder()
          .setCustomId(`resume-${i}`)
          .setLabel(`${entry.projectName} (${timeAgo})`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true);
      });
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButtons);

      try {
        await interaction.editReply({ components: [disabledRow] });
      } catch (err) {
        console.debug('[Discord] Failed to disable resume buttons:', err);
      }
    }
  });
}
