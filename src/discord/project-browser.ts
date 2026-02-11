import {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config.js';
import { sessionManager } from '../claude/session-manager.js';
import { clearConversation } from '../claude/agent.js';

export const PAGE_SIZE = 23; // 25 max select options minus 2 reserve
export const BROWSER_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export interface BrowserState {
  root: string;
  current: string;
  page: number;
}

/**
 * Determine the absolute filesystem root directory used by the project browser.
 *
 * @returns The resolved absolute root path for the browser. Prefers the `HOME` environment variable, falls back to `config.WORKSPACE_DIR`, and finally to the current working directory.
 */
export function getBrowserRoot(): string {
  return path.resolve(process.env.HOME || config.WORKSPACE_DIR || process.cwd());
}

/**
 * Get a sorted list of visible subdirectory names in a directory.
 *
 * @param dir - Path of the directory to read
 * @returns An array of subdirectory names sorted alphabetically; returns an empty array if the directory can't be read or no visible subdirectories exist
 */
export function listDirectories(dir: string): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Truncates a label to a maximum length, appending an ellipsis when truncated.
 *
 * @param name - The label to shorten
 * @param max - Maximum allowed length of the returned string
 * @returns The original `name` if its length is less than or equal to `max`, otherwise the leading characters truncated to `max - 1` plus a single-character ellipsis (`…`)
 */
export function shortenLabel(name: string, max = 25): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '\u2026';
}

/**
 * Produces a path string no longer than `max` characters by preserving the trailing portion and prefixing an ellipsis when truncation is needed.
 *
 * @param fullPath - The original path string to shorten
 * @param max - Maximum allowed length of the result, including the leading ellipsis when truncation occurs
 * @returns The original `fullPath` if its length is less than or equal to `max`, otherwise a string starting with the Unicode ellipsis character (`…`) followed by the last `max - 1` characters of `fullPath`
 */
export function shortenDescription(fullPath: string, max = 100): string {
  if (fullPath.length <= max) return fullPath;
  return '\u2026' + fullPath.slice(fullPath.length - (max - 1));
}

/**
 * Determine whether a target path is the same as or is located inside a root directory.
 *
 * @param root - The root directory to test against
 * @param target - The path to check for containment within `root`
 * @returns `true` if the resolved `target` equals `root` or is a descendant of `root`, `false` otherwise
 */
export function isWithinRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

/**
 * Construct the directory browser message content and Discord UI components for the given browser state.
 *
 * @param state - Current browser state (root, current path, and page index); `state.page` will be normalized to valid bounds.
 * @param prefix - Custom ID prefix for component custom IDs (defaults to 'project')
 * @returns An object with `content` — a header and instructions describing the current location and folder summary — and `components` — an array of ActionRowBuilder items containing the select menu and navigation/pagination buttons for the browser UI.
 */
export function buildBrowserUI(
  state: BrowserState,
  prefix = 'project',
): {
  content: string;
  components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
} {
  const dirs = listDirectories(state.current);
  const totalPages = Math.max(1, Math.ceil(dirs.length / PAGE_SIZE));
  state.page = Math.min(Math.max(state.page, 0), totalPages - 1);

  const pageEntries = dirs.slice(
    state.page * PAGE_SIZE,
    (state.page + 1) * PAGE_SIZE,
  );

  const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  // Row 1: Directory select menu (only if there are entries)
  if (pageEntries.length > 0) {
    const options = pageEntries.map(dir =>
      new StringSelectMenuOptionBuilder()
        .setLabel('\uD83D\uDCC1 ' + shortenLabel(dir))
        .setDescription(shortenDescription(path.join(state.current, dir)))
        .setValue(dir),
    );

    const select = new StringSelectMenuBuilder()
      .setCustomId(`${prefix}-dir-select`)
      .setPlaceholder('Select a folder to open\u2026')
      .addOptions(options);

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    );
  }

  // Row 2: Navigation buttons
  const canGoUp = state.current !== state.root && state.current !== '/';

  const upBtn = new ButtonBuilder()
    .setCustomId(`${prefix}-up`)
    .setLabel('\u2B06\uFE0F Up')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!canGoUp);

  const useBtn = new ButtonBuilder()
    .setCustomId(`${prefix}-use`)
    .setLabel('Use This Folder')
    .setStyle(ButtonStyle.Success);

  const manualBtn = new ButtonBuilder()
    .setCustomId(`${prefix}-manual`)
    .setLabel('Enter Path')
    .setStyle(ButtonStyle.Primary);

  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    upBtn,
    useBtn,
    manualBtn,
  );
  components.push(navRow);

  // Row 3: Pagination buttons (only if >1 page)
  if (totalPages > 1) {
    const prevBtn = new ButtonBuilder()
      .setCustomId(`${prefix}-prev`)
      .setLabel('\u25C0\uFE0F Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.page === 0);

    const pageBtn = new ButtonBuilder()
      .setCustomId(`${prefix}-page-info`)
      .setLabel(`Page ${state.page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextBtn = new ButtonBuilder()
      .setCustomId(`${prefix}-next`)
      .setLabel('Next \u25B6\uFE0F')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.page >= totalPages - 1);

    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, pageBtn, nextBtn),
    );
  }

  // Header text
  const currentDisplay = state.current.replace(process.env.HOME || '', '~');
  const folderCount = dirs.length;
  const pageInfo = totalPages > 1 ? ` | Page ${state.page + 1}/${totalPages}` : '';
  const emptyNote = pageEntries.length === 0 ? '\n\n*(No subdirectories here)*' : '';

  const content =
    `\uD83D\uDCC1 **Project Browser**\n\n` +
    `**Location:** \`${currentDisplay}\`\n` +
    `**Folders:** ${folderCount}${pageInfo}` +
    emptyNote +
    `\n\nSelect a folder to navigate into, or use the buttons below.`;

  return { content, components };
}

/**
 * Set the working directory for a chat and clear its conversation context.
 *
 * @param chatId - Identifier of the chat whose project should be set
 * @param dirPath - Absolute path of the directory to use as the project root
 * @returns A confirmation message containing the project name, its path, and a short usage hint
 */
export function setProject(chatId: number, dirPath: string): string {
  sessionManager.setWorkingDirectory(chatId, dirPath);
  clearConversation(chatId);
  const name = path.basename(dirPath) || dirPath;
  return `Project set: **${name}**\n\`${dirPath}\`\n\n@mention the bot or use \`/chat\` to talk to Claude.`;
}