import {
  ChatInputCommandInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  ComponentType,
} from 'discord.js';
import { discordChatId } from '../id-mapper.js';
import { setModel, getModel } from '../../claude/agent.js';

/**
 * Presents a model selection menu to the invoking user and updates the stored model when they make a choice.
 *
 * Sends an ephemeral reply showing the current model and a select menu (options: Opus, Sonnet, Haiku) with the current model preselected, listens for the user's selection for up to 60 seconds, updates the stored model for the user's chatId, and edits the reply to confirm the new model.
 *
 * @param interaction - The chat input command interaction that triggered the selector; the reply and selection are handled via this interaction
 */
export async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const chatId = discordChatId(interaction.user.id);
  const current = getModel(chatId);

  const select = new StringSelectMenuBuilder()
    .setCustomId('model-select')
    .setPlaceholder(`Current: ${current}`)
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Opus').setDescription('Most capable model').setValue('opus').setDefault(current === 'opus'),
      new StringSelectMenuOptionBuilder().setLabel('Sonnet').setDescription('Balanced speed and capability').setValue('sonnet').setDefault(current === 'sonnet'),
      new StringSelectMenuOptionBuilder().setLabel('Haiku').setDescription('Fastest model').setValue('haiku').setDefault(current === 'haiku'),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const response = await interaction.reply({
    content: `**Model Selector**\nCurrent model: **${current}**`,
    components: [row],
    ephemeral: true,
  });

  try {
    const collector = response.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60_000 });
    collector.on('collect', async (i) => {
      const selected = i.values[0];
      setModel(chatId, selected);
      await i.update({ content: `Model set to **${selected}**`, components: [] });
    });
  } catch { /* timeout, ignore */ }
}