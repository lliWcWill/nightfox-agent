import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { jobManager } from '../../jobs/index.js';
import {
  coderabbitReview,
  type CodeRabbitPayload,
} from '../../jobs/workers/coderabbit-review.js';
import { splitDiscordMessage } from '../markdown.js';

function repoPathFromEnvOrCwd() {
  return process.env.NIGHTFOX_REPO_PATH || process.env.CLAUDEGRAM_REPO_PATH || process.cwd();
}

export async function creviewCommand(interaction: ChatInputCommandInteraction) {
  const baseRef = interaction.options.getString('base') ?? 'origin/main';
  const type = (interaction.options.getString('type') as 'committed' | 'uncommitted' | 'all' | null) ?? 'committed';
  const targets: Array<'committed' | 'uncommitted'> = type === 'all' ? ['committed', 'uncommitted'] : [type];
  const repoPath = repoPathFromEnvOrCwd();

  const jobs = targets.map((target) => {
    const payload: CodeRabbitPayload = {
      repoPath,
      baseRef,
      target,
      promptOnly: true,
    };
    return jobManager.create('coderabbit-review', payload, coderabbitReview);
  });

  const firstJob = jobs[0];

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`creview:cancel:${firstJob.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`creview:show:${firstJob.id}`)
      .setLabel('Show output')
      .setStyle(ButtonStyle.Primary),
  );

  const extra = jobs.length > 1
    ? ` (queued ${jobs.length} jobs: ${jobs.map(j => `\`${j.id}\``).join(', ')})`
    : '';

  await interaction.reply({
    content: `Started CodeRabbit review (job \`${firstJob.id}\`) vs \`${baseRef}\` (type: \`${type}\`, repo: \`${repoPath}\`).${extra}`,
    components: [row],
  });

  // Best-effort completion notification for the first job (keeps noise down).
  const interval = setInterval(async () => {
    const j = jobManager.get(firstJob.id);
    if (!j) return;
    if (j.state === 'queued' || j.state === 'running') return;
    clearInterval(interval);

    const ms = (j.finishedAt ?? Date.now()) - (j.startedAt ?? j.createdAt);
    const secs = (ms / 1000).toFixed(1);
    const status = j.state === 'succeeded'
      ? '✅ Done'
      : j.state === 'cancelled'
        ? '🛑 Cancelled'
        : '❌ Failed';

    try {
      await interaction.editReply({
        content: `${status} — job \`${firstJob.id}\` (${secs}s).\nStarted CodeRabbit review vs \`${baseRef}\` (type: \`${type}\`, repo: \`${repoPath}\`).${extra}`,
      });
    } catch {
      // ignore
    }
  }, 1500);
}

export async function creviewButton(interaction: ButtonInteraction) {
  const [prefix, action, jobId] = String(interaction.customId).split(':');
  if (prefix !== 'creview' || !action || !jobId) return;

  const job = jobManager.get(jobId);
  if (!job) {
    await interaction.reply({ content: `Job not found: \`${jobId}\``, ephemeral: true });
    return;
  }

  if (action === 'cancel') {
    const ok = jobManager.cancel(jobId);
    await interaction.reply({
      content: ok ? `Cancelled job \`${jobId}\`.` : `Can't cancel job \`${jobId}\` (state: ${job.state}).`,
      ephemeral: true,
    });
    return;
  }

  if (action === 'show') {
    if (job.state === 'queued' || job.state === 'running') {
      await interaction.reply({ content: `Job \`${jobId}\` is ${job.state}...`, ephemeral: true });
      return;
    }

    if (job.state === 'failed') {
      const chunks = splitDiscordMessage(`CodeRabbit failed:\n\n${job.error ?? '(no error)'}\n`, 1900);
      await interaction.reply({ content: chunks[0], ephemeral: true });
      for (const c of chunks.slice(1)) await interaction.followUp({ content: c, ephemeral: true });
      return;
    }

    const res: any = job.result;
    const out = [
      `Command: ${res?.command ?? ''}`,
      `Exit: ${res?.exitCode ?? ''}`,
      '',
      'STDOUT:',
      res?.stdout ?? '',
      '',
      'STDERR:',
      res?.stderr ?? '',
    ].join('\n');

    const chunks = splitDiscordMessage(out, 1900);
    await interaction.reply({ content: chunks[0], ephemeral: true });
    for (const c of chunks.slice(1)) await interaction.followUp({ content: c, ephemeral: true });
  }
}
