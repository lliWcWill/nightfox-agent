import { Interaction, GuildMember, Message } from 'discord.js';
import { discordConfig } from '../discord-config.js';

/**
 * Determine whether a Discord user is permitted to use the bot.
 *
 * Checks the configured user allowlist and, if a guild member is provided, allowed role IDs.
 *
 * @param member - The guild member to check for allowed roles; if omitted, role-based checks are skipped
 * @returns `true` if the user ID is allowlisted or the member has an allowed role, `false` otherwise
 */
export function isAuthorizedUser(userId: string, member?: GuildMember | null): boolean {
  // Check user ID allowlist
  if (discordConfig.DISCORD_ALLOWED_USER_IDS.includes(userId)) {
    return true;
  }

  // Check role-based access if configured
  if (discordConfig.DISCORD_ALLOWED_ROLE_IDS.length > 0 && member) {
    for (const roleId of discordConfig.DISCORD_ALLOWED_ROLE_IDS) {
      if (member.roles.cache.has(roleId)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Determine whether the user who initiated an interaction is authorized to use the bot.
 *
 * If the user is not authorized and the interaction can be replied to, an ephemeral rejection message is sent and the rejection is logged to the console.
 *
 * @param interaction - The Discord interaction to check.
 * @returns `true` if the interaction's user is authorized, `false` otherwise.
 */
export async function checkInteractionAuth(interaction: Interaction): Promise<boolean> {
  const userId = interaction.user.id;
  const member = interaction.member as GuildMember | null;

  if (isAuthorizedUser(userId, member)) {
    return true;
  }

  if (interaction.isRepliable()) {
    await interaction.reply({
      content: 'You are not authorized to use this bot.',
      ephemeral: true,
    });
  }

  console.log(`[Discord] Rejected: Unauthorized user ${userId} (${interaction.user.tag})`);
  return false;
}

/**
 * Determine whether the author of a Discord message is authorized to use the bot.
 *
 * @param message - The Discord message whose author will be checked for authorization
 * @returns `true` if the message author is authorized, `false` otherwise
 */
export function isAuthorizedMessage(message: Message): boolean {
  const userId = message.author.id;
  const member = message.member;
  return isAuthorizedUser(userId, member);
}