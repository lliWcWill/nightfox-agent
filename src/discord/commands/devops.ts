import {
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { jobRunner } from '../../jobs/index.js';
import { npmBuildV2, type NpmBuildV2Payload } from '../../jobs/workers/npm-build-v2.js';
import {
  fullSelfRefreshJob,
  restartDiscordServiceJob,
  selfCheckJob,
  selfUpdateJob,
} from '../../jobs/workers/devops-maintenance.js';
import { agentDeepLoopJob, type AgentDeepLoopPayload } from '../../jobs/workers/agent-deep-loop.js';
import { postJobStarted } from '../jobs/job-notifier.js';

function repoPathFromEnvOrCwd() {
  return process.env.CLAUDEGRAM_REPO_PATH || process.cwd();
}

export const devopsSlash = new SlashCommandBuilder()
  .setName('devops')
  .setDescription('Run background DevOps jobs (build, typecheck, etc.)')
  .addSubcommand((sub) =>
    sub
      .setName('run')
      .setDescription('Run a devops job')
      .addStringOption((opt) =>
        opt
          .setName('job')
          .setDescription('Job to run')
          .setRequired(true)
          .addChoices(
            { name: 'build', value: 'build' },
            { name: 'self-check', value: 'self-check' },
            { name: 'self-update', value: 'self-update' },
            { name: 'restart-discord-service', value: 'restart-discord-service' },
            { name: 'full-self-refresh', value: 'full-self-refresh' },
            { name: 'agent-loop-30m', value: 'agent-loop-30m' },
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('deep')
      .setDescription('Run a 30m agent deep loop and report back')
      .addStringOption((opt) => opt.setName('task').setDescription('Deep task prompt').setRequired(true))
      .addStringOption((opt) => opt.setName('model').setDescription('Optional model override').setRequired(false)),
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Show last job status (coming soon)'));

export async function devopsCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    await interaction.reply({
      content: 'Use /devops run with one of: build, self-check, self-update, restart-discord-service, full-self-refresh, agent-loop-30m — or /devops deep task:<prompt>',
      ephemeral: true,
    });
    return;
  }

  let jobName = interaction.options.getString('job', false) || '';
  let deepTask = '';
  let deepModel: string | undefined;
  if (sub === 'deep') {
    jobName = 'agent-loop-30m';
    deepTask = interaction.options.getString('task', true);
    deepModel = interaction.options.getString('model', false) ?? undefined;
  }

  const known = new Set([
    'build',
    'self-check',
    'self-update',
    'restart-discord-service',
    'full-self-refresh',
    'agent-loop-30m',
  ]);
  if (!known.has(jobName)) {
    await interaction.reply({ content: `Unknown job: ${jobName}`, ephemeral: true });
    return;
  }

  const repoPath = repoPathFromEnvOrCwd();

  let handler;
  if (jobName === 'build') {
    const payload: NpmBuildV2Payload = { repoPath };
    handler = npmBuildV2(payload);
  } else if (jobName === 'self-check') {
    handler = selfCheckJob(repoPath);
  } else if (jobName === 'self-update') {
    handler = selfUpdateJob(repoPath);
  } else if (jobName === 'restart-discord-service') {
    handler = restartDiscordServiceJob();
  } else if (jobName === 'full-self-refresh') {
    handler = fullSelfRefreshJob(repoPath);
  } else {
    const payload: AgentDeepLoopPayload = {
      userId: interaction.user.id,
      task:
        deepTask ||
        'Run a 30 minute deep implementation/research loop and return a concise report with findings, diffs, and next actions.',
      model: deepModel,
    };
    handler = agentDeepLoopJob(payload);
  }

  const jobId = jobRunner.enqueue({
    name: `devops:${jobName}`,
    origin: {
      guildId: interaction.guildId ?? undefined,
      channelId: interaction.channelId,
      threadId: interaction.channel?.isThread() ? interaction.channelId : undefined,
      userId: interaction.user.id,
    },
    handler,
    timeoutMs: jobName === 'agent-loop-30m' ? 1000 * 60 * 30 : 1000 * 60 * 15,
  });

  await postJobStarted(interaction, jobId);
}

export async function devopsButton(_interaction: ButtonInteraction) {
  // handled by generic job buttons now
}
