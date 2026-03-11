import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

async function loadFreshDashboardPortDefault() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'nightfox-config-'));
  const envPath = path.join(tempDir, '.env');
  writeFileSync(envPath, '', 'utf8');
  const originalDashboardPort = process.env.DASHBOARD_PORT;
  const originalNightfoxEnvPath = process.env.NIGHTFOX_ENV_PATH;

  try {
    delete process.env.DASHBOARD_PORT;
    process.env.NIGHTFOX_ENV_PATH = envPath;
    const configUrl = `${pathToFileURL(path.join(REPO_ROOT, 'src/config.ts')).href}?dashboard-port-test=${Date.now()}`;
    const { config } = await import(configUrl);
    return String(config.DASHBOARD_PORT);
  } finally {
    if (originalDashboardPort === undefined) {
      delete process.env.DASHBOARD_PORT;
    } else {
      process.env.DASHBOARD_PORT = originalDashboardPort;
    }
    if (originalNightfoxEnvPath === undefined) {
      delete process.env.NIGHTFOX_ENV_PATH;
    } else {
      process.env.NIGHTFOX_ENV_PATH = originalNightfoxEnvPath;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function reservePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object', 'expected a reserved TCP port');

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return address.port;
}

function startDashboardProcess(port: number) {
  return spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      "const { startDashboardServer } = await import('./src/dashboard/server.ts'); startDashboardServer(Number(process.env.TEST_PORT));",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        TEST_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function waitForServer(url: string) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error(`Timed out waiting for dashboard server at ${url}`);
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  const exitPromise = once(child, 'exit');
  child.kill('SIGTERM');

  const exited = await Promise.race([
    exitPromise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);

  if (!exited) {
    child.kill('SIGKILL');
    await exitPromise;
  }
}

test('dashboard config defaults DASHBOARD_PORT to 3011 when unset', async () => {
  assert.equal(await loadFreshDashboardPortDefault(), '3011');
});

test('dashboard server exposes explicit health at /healthz', async () => {
  const port = await reservePort();
  const child = startDashboardProcess(port);

  try {
    const healthResponse = await waitForServer(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthResponse.status, 200);
      assert.deepEqual(await healthResponse.json(), {
        status: 'ok',
        service: 'nightfox-dashboard',
        endpoint: 'healthz',
      });

      const rootResponse = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(rootResponse.status, 200);
      assert.deepEqual(await rootResponse.json(), {
        status: 'ok',
        service: 'nightfox-dashboard',
      });
    } finally {
      await stopProcess(child);
    }
  });
