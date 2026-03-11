import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { runWithToolContext } from './openai-tool-context.js';
import { createFsuiteTools } from './openai-tools.js';

function listMarkerPids(marker: string): string[] {
  try {
    return execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function killMarkerProcesses(marker: string): void {
  try {
    execFileSync('pkill', ['-f', marker], { stdio: 'ignore' });
  } catch {
    // Ignore missing-process exit codes.
  }
}

async function waitForMarkerExit(marker: string, timeoutMs = 1_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listMarkerPids(marker).length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function getShellTool() {
  const shell = createFsuiteTools(process.cwd(), true).find((tool) => tool.name === 'shell');
  assert.ok(shell, 'expected shell tool to be registered');
  return shell as { invoke: (runContext: unknown, input: string, details?: unknown) => Promise<unknown> };
}

test('shell tool timeout kills spawned descendants and leaves no orphan process', async (t) => {
  const marker = `nightfox-openai-timeout-${process.pid}-${Date.now()}`;
  const shell = getShellTool();

  killMarkerProcesses(marker);
  t.after(async () => {
    killMarkerProcesses(marker);
    await waitForMarkerExit(marker);
  });

  await shell.invoke(
    undefined,
    JSON.stringify({
      command: `node -e "setInterval(() => {}, 1000)" ${marker}`,
      timeout_ms: 300,
      max_output_bytes: 8_000,
    }),
    undefined,
  );

  await waitForMarkerExit(marker);
  assert.deepEqual(listMarkerPids(marker), [], 'expected timeout to reap spawned child processes');
});

test('shell tool abort signal kills spawned descendants promptly and leaves no orphan process', async (t) => {
  const marker = `nightfox-openai-abort-${process.pid}-${Date.now()}`;
  const shell = getShellTool();
  const controller = new AbortController();

  killMarkerProcesses(marker);
  t.after(async () => {
    killMarkerProcesses(marker);
    await waitForMarkerExit(marker);
  });

  const startedAt = Date.now();
  const invocation = runWithToolContext({ chatId: 42, signal: controller.signal } as any, () =>
    shell.invoke(
      undefined,
      JSON.stringify({
        command: `node -e "setInterval(() => {}, 1000)" ${marker}`,
        timeout_ms: 1_000,
        max_output_bytes: 8_000,
      }),
      undefined,
    ),
  );

  setTimeout(() => controller.abort(), 50);

  const result = await invocation;
  assert.match(String(result), /aborted/i);
  assert.ok(Date.now() - startedAt < 700, 'expected abort to stop tool execution before timeout fallback');
  await waitForMarkerExit(marker);
  assert.deepEqual(listMarkerPids(marker), [], 'expected abort to reap spawned child processes');
});
