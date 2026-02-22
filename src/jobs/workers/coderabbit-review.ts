import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import type { JobRecord } from '../job-manager.js';

export type CodeRabbitPayload = {
  repoPath: string;
  baseRef: string;
  target: 'committed' | 'uncommitted';
  promptOnly: boolean;
};

export type CodeRabbitResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  command: string;
};

function run(cmd: string, args: string[], cwd: string, onCancel: (fn: () => void) => void) {
  return new Promise<CodeRabbitResult>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env });

    let stdout = '';
    let stderr = '';

    onCancel(() => {
      try {
        child.kill('SIGTERM');
      } catch {}
    });

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode, command: [cmd, ...args].join(' ') });
    });
  });
}

async function resolveCodeRabbitBinary(): Promise<string> {
  const home = process.env.HOME;
  const candidates = [
    home ? `${home}/.local/bin/coderabbit` : null,
    'coderabbit',
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (c.includes('/')) {
      try {
        await access(c, FS.X_OK);
        return c;
      } catch {
        // continue
      }
    } else {
      // rely on PATH
      return c;
    }
  }

  throw new Error('CodeRabbit binary not found. Expected ~/.local/bin/coderabbit or coderabbit in PATH.');
}

export async function coderabbitReview(job: JobRecord<CodeRabbitPayload, CodeRabbitResult>) {
  const { repoPath, baseRef, target, promptOnly } = job.payload;

  const cmd = await resolveCodeRabbitBinary();
  const args = ['review'];
  if (promptOnly) args.push('--prompt-only');
  args.push('-t', target);
  args.push('--base', baseRef);

  let cancelFn: (() => void) | undefined;
  job.cancel = () => cancelFn?.();

  return await run(cmd, args, repoPath, (fn) => (cancelFn = fn));
}
