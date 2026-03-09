import { createDiscordBot } from './discord/discord-bot.js';
import { registerCommands } from './discord/commands/register.js';
import { discordConfig } from './discord/discord-config.js';
import { disconnectAll } from './discord/voice-channel/voice-connection.js';
import { config } from './config.js';
import { startDashboardServer, stopDashboardServer } from './dashboard/server.js';
import { mcpManager } from './providers/openai-mcp.js';

/**
 * Initialize and start the Nightfox Discord bot, register slash commands, optionally start the dashboard, and install a graceful shutdown sequence.
 *
 * When run, this function registers slash commands, starts the dashboard server if enabled, creates and logs in the Discord client using configured credentials, and registers handlers for SIGINT and SIGTERM. The installed shutdown routine stops the dashboard, disconnects all active voice sessions, destroys the Discord client, and exits the process with code 0.
 */
async function main() {
  console.log('Starting Nightfox Discord bot...');
  console.log(`Allowed users: ${discordConfig.DISCORD_ALLOWED_USER_IDS.join(', ')}`);

  // Register slash commands
  await registerCommands();

  // Start dashboard server if enabled
  if (config.DASHBOARD_ENABLED) {
    startDashboardServer(config.DASHBOARD_PORT);
  }

  // Create and start the bot
  const client = createDiscordBot();

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down Discord bot...');
    stopDashboardServer();

    // Gracefully disconnect all voice sessions first (closes Gemini, kills ffmpeg cleanly)
    await disconnectAll();

    // Close MCP servers (ShieldCortex, Playwright, etc.)
    await mcpManager.closeAll();

    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => { shutdown(); });
  process.on('SIGTERM', () => { shutdown(); });

  await client.login(discordConfig.DISCORD_BOT_TOKEN);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});