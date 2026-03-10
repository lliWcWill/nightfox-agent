import {
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { sessionManager } from '../../claude/session-manager.js';
import { resolveDiscordSessionLane } from '../session-lane.js';
import {
  type BrowserState,
  BROWSER_TIMEOUT,
  getBrowserRoot,
  buildBrowserUI,
  isWithinRoot,
  setProject,
} from '../project-browser.js';

// Active browser states per user
const browserStates = new Map<string, BrowserState>();

/**
 * Handle the `/project` chat command by either setting the user's project path immediately
 * when a `path` option is provided, or launching an interactive in-channel directory browser
 * to navigate and select a project directory.
 *
 * The interactive flow maintains per-user browser state, renders navigation UI, accepts
 * directory selection, pagination, parent navigation, manual path entry via a modal, and
 * commits the chosen directory as the user's project.
 *
 * @param interaction - The Discord ChatInputCommandInteraction for the invoking user and command options
 */
export async function handleProject(interaction: ChatInputCommandInteraction): Promise<void> {
  let lane = resolveDiscordSessionLane(interaction.user.id, interaction.channelId);
  if (lane.projectSource === 'legacy') {
    sessionManager.seedWorkingDirectoryFromSession(lane.legacyChatId, lane.scopedChatId);
    lane = resolveDiscordSessionLane(interaction.user.id, interaction.channelId);
  }

  const chatId = lane.scopedChatId;
  const projectPath = interaction.options.getString('path');

  // Direct path: set immediately
  if (projectPath) {
    let resolvedPath = projectPath;
    if (resolvedPath.startsWith('~')) {
      resolvedPath = path.join(process.env.HOME || '', resolvedPath.slice(1));
    }
    resolvedPath = path.resolve(resolvedPath);

    if (!fs.existsSync(resolvedPath)) {
      await interaction.reply({ content: `Path not found: \`${resolvedPath}\``, ephemeral: true });
      return;
    }
    if (!fs.statSync(resolvedPath).isDirectory()) {
      await interaction.reply({ content: `Not a directory: \`${resolvedPath}\``, ephemeral: true });
      return;
    }

    await interaction.reply({ content: setProject(chatId, resolvedPath), ephemeral: true });
    return;
  }

  // No path: launch interactive browser
  const root = getBrowserRoot();
  const state: BrowserState = { root, current: root, page: 0 };

  // Start from current session directory if within root
  const session = lane.scopedSession ?? sessionManager.getSession(chatId);
  if (session && isWithinRoot(root, session.workingDirectory)) {
    state.current = session.workingDirectory;
  }

  browserStates.set(interaction.user.id, state);
  const ui = buildBrowserUI(state);

  const response = await interaction.reply({
    content: ui.content,
    components: ui.components,
    ephemeral: true,
  });

  const collector = response.createMessageComponentCollector({ time: BROWSER_TIMEOUT });

  collector.on('collect', async (i) => {
    try {
      // Directory selection — navigate into
      if (i.isStringSelectMenu() && i.customId === 'project-dir-select') {
        const selected = i.values[0];
        const nextPath = path.join(state.current, selected);
        if (fs.existsSync(nextPath) && fs.statSync(nextPath).isDirectory()) {
          state.current = nextPath;
          state.page = 0;
        }
        const updated = buildBrowserUI(state);
        await i.update({ content: updated.content, components: updated.components });
        return;
      }

      if (!i.isButton()) return;

      switch (i.customId) {
        case 'project-up': {
          const parent = path.dirname(state.current);
          if (parent !== state.current) {
            state.current = parent;
            state.page = 0;
          }
          const updated = buildBrowserUI(state);
          await i.update({ content: updated.content, components: updated.components });
          break;
        }

        case 'project-use': {
          const msg = setProject(chatId, state.current);
          await i.update({ content: msg, components: [] });
          browserStates.delete(interaction.user.id);
          collector.stop();
          break;
        }

        case 'project-prev': {
          state.page = Math.max(0, state.page - 1);
          const updated = buildBrowserUI(state);
          await i.update({ content: updated.content, components: updated.components });
          break;
        }

        case 'project-next': {
          state.page += 1;
          const updated = buildBrowserUI(state);
          await i.update({ content: updated.content, components: updated.components });
          break;
        }

        case 'project-manual': {
          const modal = new ModalBuilder()
            .setCustomId(`project-modal-${interaction.user.id}`)
            .setTitle('Enter Project Path');

          const input = new TextInputBuilder()
            .setCustomId('project-path-input')
            .setLabel('Directory path')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('/home/user/projects/myapp')
            .setValue(state.current)
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(input),
          );

          await i.showModal(modal);

          try {
            const modalSubmit = await i.awaitModalSubmit({ time: 60_000 });
            let inputPath = modalSubmit.fields.getTextInputValue('project-path-input').trim();

            if (inputPath.startsWith('~')) {
              inputPath = path.join(process.env.HOME || '', inputPath.slice(1));
            }
            inputPath = path.resolve(inputPath);

            if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory()) {
              await modalSubmit.reply({
                content: `Not a valid directory: \`${inputPath}\``,
                ephemeral: true,
              });
              return;
            }

            // Navigate to the entered path
            state.current = inputPath;
            // Update root if outside current root to allow continued browsing
            if (!isWithinRoot(state.root, inputPath)) {
              state.root = inputPath;
            }
            state.page = 0;

            const updated = buildBrowserUI(state);
            if (modalSubmit.isFromMessage()) {
              await modalSubmit.update({ content: updated.content, components: updated.components });
            } else {
              await modalSubmit.reply({ content: updated.content, components: updated.components, ephemeral: true });
            }
          } catch {
            // Modal timed out — ignore
          }
          break;
        }
      }
    } catch (error) {
      console.error('[Discord] Project browser error:', error);
    }
  });

  collector.on('end', () => {
    browserStates.delete(interaction.user.id);
  });
}
