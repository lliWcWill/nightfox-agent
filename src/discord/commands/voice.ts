import {
  ChatInputCommandInteraction,
  ChannelType,
  GuildMember,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { config } from '../../config.js';
import {
  joinAndConnect,
  disconnect,
  sendTextToGemini,
  isInVoiceChannel,
  getVoiceSession,
} from '../voice-channel/voice-connection.js';

/**
 * Dispatches a chat input command interaction to the appropriate voice subcommand handler.
 *
 * @param interaction - The ChatInputCommandInteraction representing the invoked /voice command and its subcommand
 */
export async function handleVoice(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'join':
      await handleJoin(interaction);
      break;
    case 'leave':
      await handleLeave(interaction);
      break;
    case 'say':
      await handleSay(interaction);
      break;
    case 'status':
      await handleStatus(interaction);
      break;
    default:
      await interaction.reply({ content: `Unknown subcommand: ${sub}`, ephemeral: true });
  }
}

/**
 * Connects the bot to the invoking user's voice channel and starts a Gemini Live audio session.
 *
 * Validates configuration and guild context, ensures the user is in a voice channel, defers the reply,
 * opens the voice connection, and forwards Gemini text responses to the interaction's text channel.
 * Edits the original reply with a success embed on join or an error message on failure.
 *
 * @param interaction - The Chat Input Command interaction that triggered the join request
 */
async function handleJoin(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!config.GEMINI_API_KEY) {
    await interaction.reply({ content: 'GEMINI_API_KEY not configured.', ephemeral: true });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const member = interaction.member;
  if (!member || !('voice' in member)) {
    await interaction.reply({ content: 'Could not determine your voice state.', ephemeral: true });
    return;
  }
  const voiceChannel = (member as GuildMember).voice.channel;

  if (!voiceChannel) {
    await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const textChannel = interaction.channel;
    const textChannelId = interaction.channelId;

    await joinAndConnect(voiceChannel, {
      textChannelId,
      onTextMessage: async (text) => {
        // Send Gemini's text responses to the text channel
        if (textChannel && 'send' in textChannel) {
          try {
            const embed = new EmbedBuilder()
              .setColor(0x4285F4) // Google blue
              .setDescription(text.length > 4000 ? text.slice(0, 4000) + '...' : text)
              .setFooter({ text: 'Gemini Live' });
            await (textChannel as TextChannel).send({ embeds: [embed] });
          } catch (err) {
            console.debug('[Voice] Failed to send text message to channel:', err);
          }
        }
      },
    });

    const embed = new EmbedBuilder()
      .setColor(0x57F287) // Green
      .setDescription(`Joined **${voiceChannel.name}** with Gemini Live Audio.\nSpeak in the voice channel or use \`/voice say\` to send text.`)
      .setFooter({ text: 'Powered by Gemini 2.5 Flash Dialog (v1alpha)' });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`Failed to join: ${msg.slice(0, 300)}`);
  }
}

/**
 * Handle the "leave" voice subcommand: disconnect the bot from the guild's voice channel and reply to the user.
 *
 * Checks that the command was issued in a server and that the bot is currently in a voice channel for that guild;
 * replies with an ephemeral error message if either check fails. If connected, disconnects and sends a confirmation reply.
 *
 * @param interaction - The command interaction that invoked the subcommand
 */
async function handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const guildId = interaction.guild.id;

  if (!isInVoiceChannel(guildId)) {
    await interaction.reply({ content: 'Not in a voice channel.', ephemeral: true });
    return;
  }

  await disconnect(guildId);
  await interaction.reply('Disconnected from voice channel.');
}

/**
 * Sends the command's `text` option to the guild's active Gemini Live session and replies with a confirmation or error.
 *
 * Reads the required `text` string option from the interaction, verifies the command is executed in a guild and that a Gemini Live voice session is active for that guild, forwards the text to Gemini, and replies to the user indicating success or the reason for failure.
 *
 * @param interaction - The chat input command interaction containing the required `text` option
 */
async function handleSay(interaction: ChatInputCommandInteraction): Promise<void> {
  const text = interaction.options.getString('text', true);

  if (!interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const guildId = interaction.guild.id;

  if (!isInVoiceChannel(guildId)) {
    await interaction.reply({ content: 'Not in a voice channel. Use `/voice join` first.', ephemeral: true });
    return;
  }

  const sent = sendTextToGemini(guildId, text);
  if (sent) {
    await interaction.reply({
      content: `Sent to Gemini: *${text.length > 200 ? text.slice(0, 200) + '...' : text}*`,
    });
  } else {
    await interaction.reply({ content: 'Gemini Live session is not active.', ephemeral: true });
  }
}

/**
 * Display the current voice session status for the guild where the command was invoked.
 *
 * Replies ephemerally with an embed that includes the voice channel (or channel id if unknown),
 * Gemini connection state (Connected / Disconnected), and the number of active listeners.
 * If the command is used outside a guild, or if no voice session exists for the guild,
 * an ephemeral informational message is sent instead.
 *
 * @param interaction - The chat input command interaction that triggered this status check
 */
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const guildId = interaction.guild.id;
  const session = getVoiceSession(guildId);

  if (!session) {
    await interaction.reply({
      content: 'Not in a voice channel.',
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.guild.channels.cache.get(session.channelId);
  const channelName = channel?.name || session.channelId;
  const geminiStatus = session.gemini?.isOpen ? 'Connected' : 'Disconnected';
  const listeners = session.subscriptions.size;

  const embed = new EmbedBuilder()
    .setColor(0x4285F4)
    .setTitle('Gemini Live Voice')
    .addFields(
      { name: 'Channel', value: channelName, inline: true },
      { name: 'Gemini', value: geminiStatus, inline: true },
      { name: 'Active Listeners', value: String(listeners), inline: true },
    )
    .setFooter({ text: 'gemini-2.5-flash-dialog (v1alpha)' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}