import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { JobHandler } from '../core/job-types';
import { DISCORD_SERVICE_NAME } from '../../utils/app-paths.js';

const execAsync = promisify(exec);

type CmdStep = { name: string; command: string };

async function runStep(ctx: Parameters<JobHandler>[0], cwd: string, step: CmdStep) {
  ctx.progress(step.name);
  ctx.log('info', `Running: ${step.command}`);
  const { stdout, stderr } = await execAsync(step.command, {
    cwd,
    maxBuffer: 1024 * 1024 * 10,
    env: { ...process.env },
    signal: ctx.signal as any,
  });
  if (stdout) ctx.log('info', stdout.trim().slice(-12000));
  if (stderr) ctx.log('warn', stderr.trim().slice(-12000));
}

export const selfCheckJob = (repoPath: string): JobHandler => {
  return async (ctx) => {
    await runStep(ctx, repoPath, { name: 'typecheck', command: 'npm run typecheck' });
    await runStep(ctx, repoPath, { name: 'build', command: 'npm run build' });
    ctx.progress('done');
    return { exitCode: 0 };
  };
};

export const selfUpdateJob = (repoPath: string): JobHandler => {
  return async (ctx) => {
    await runStep(ctx, repoPath, { name: 'git fetch', command: 'git fetch --all --prune' });
    await runStep(ctx, repoPath, { name: 'git pull', command: 'git pull --ff-only' });
    await runStep(ctx, repoPath, { name: 'deps', command: 'npm install --include=dev' });
    await runStep(ctx, repoPath, { name: 'typecheck', command: 'npm run typecheck' });
    await runStep(ctx, repoPath, { name: 'build', command: 'npm run build' });
    ctx.progress('done');
    return { exitCode: 0 };
  };
};

export const restartDiscordServiceJob = (): JobHandler => {
  return async (ctx) => {
      await runStep(ctx, process.cwd(), {
        name: 'service restart',
        command: `systemctl --user restart ${DISCORD_SERVICE_NAME}`,
      });
      await runStep(ctx, process.cwd(), {
        name: 'service status',
        command: `systemctl --user --no-pager --lines=20 status ${DISCORD_SERVICE_NAME}`,
      });
    ctx.progress('done');
    return { exitCode: 0 };
  };
};

export const fullSelfRefreshJob = (repoPath: string): JobHandler => {
  return async (ctx) => {
    await runStep(ctx, repoPath, { name: 'git fetch', command: 'git fetch --all --prune' });
    await runStep(ctx, repoPath, { name: 'git pull', command: 'git pull --ff-only' });
    await runStep(ctx, repoPath, { name: 'deps', command: 'npm install --include=dev' });
    await runStep(ctx, repoPath, { name: 'typecheck', command: 'npm run typecheck' });
    await runStep(ctx, repoPath, { name: 'build', command: 'npm run build' });
      await runStep(ctx, process.cwd(), {
        name: 'service restart',
        command: `systemctl --user restart ${DISCORD_SERVICE_NAME}`,
      });
      await runStep(ctx, process.cwd(), {
        name: 'service status',
        command: `systemctl --user --no-pager --lines=20 status ${DISCORD_SERVICE_NAME}`,
      });
    ctx.progress('done');
    return { exitCode: 0 };
  };
};
