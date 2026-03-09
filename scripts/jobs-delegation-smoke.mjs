import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const distRoot = path.join(repoRoot, 'dist');

async function importDist(relPath) {
  return import(pathToFileURL(path.join(distRoot, relPath)).href);
}

async function findUnusedChatId() {
  const { sessionHistory } = await importDist('claude/session-history.js');
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = 900000000000000 + Math.floor(Math.random() * 1000000) + attempt;
    if (sessionHistory.getHistory(candidate, 1).length === 0) {
      return candidate;
    }
  }
  throw new Error('unable to find an unused chat id for notifier fallback smoke');
}

async function runRehydrationSmoke(tmpRoot) {
  const [{ JobRegistry }, { JobRunner }, { canResumeJobLane }] = await Promise.all([
    importDist('jobs/core/job-registry.js'),
    importDist('jobs/core/job-runner.js'),
    importDist('jobs/core/job-definitions.js'),
  ]);

  const registry = new JobRegistry({
    persistPath: path.join(tmpRoot, '.claudegram', 'jobs', 'jobs.jsonl'),
    ttlMs: 1000 * 60 * 60,
    maxLogsPerJob: 200,
  });
  const runner = new JobRunner(registry, 1);

  const queuedAt = Date.now();
  const resumableSpec = {
    kind: 'agent-deep-loop',
    payload: {
      parentChatId: 101,
      childChatId: 202,
      task: 'smoke delegated resume',
      model: 'gpt-5.3-codex-spark',
      maxIterations: 1,
    },
  };

  registry.apply({
    type: 'job:queued',
    jobId: 'resume-ok',
    name: 'smoke:resume-ok',
    lane: 'subagent',
    at: queuedAt,
    rootJobId: 'resume-ok',
    resumeSpec: resumableSpec,
  });
  registry.setOrigin('resume-ok', { channelId: 'resume-channel', userId: 'resume-user' });

  registry.apply({
    type: 'job:queued',
    jobId: 'main-skip',
    name: 'smoke:main-skip',
    lane: 'main',
    at: queuedAt + 1,
    rootJobId: 'main-skip',
    resumeSpec: resumableSpec,
  });
  registry.setOrigin('main-skip', { channelId: 'main-channel', userId: 'main-user' });

  registry.apply({
    type: 'job:queued',
    jobId: 'missing-origin',
    name: 'smoke:missing-origin',
    lane: 'subagent',
    at: queuedAt + 2,
    rootJobId: 'missing-origin',
    resumeSpec: resumableSpec,
  });

  const recovery = runner.rehydrateQueuedJobs({
    reason: 'delegation-smoke',
    shouldResumeLane: canResumeJobLane,
    resolveHandler: (snapshot) =>
      async () => ({
        exitCode: 0,
        resultSummary: `rehydrated ${snapshot.jobId}`,
      }),
  });

  await sleep(150);

  const resumed = runner.get('resume-ok');
  const mainSkipped = runner.get('main-skip');
  const missingOrigin = runner.get('missing-origin');

  assert(recovery.resumed === 1, `expected one resumed job, got ${recovery.resumed}`);
  assert(recovery.finalized === 2, `expected two finalized jobs, got ${recovery.finalized}`);
  assert(resumed?.state === 'succeeded', `resume-ok state=${resumed?.state}`);
  assert(resumed?.resultSummary === 'rehydrated resume-ok', `resume-ok summary=${resumed?.resultSummary}`);
  assert(mainSkipped?.state === 'timeout', `main-skip state=${mainSkipped?.state}`);
  assert(missingOrigin?.state === 'timeout', `missing-origin state=${missingOrigin?.state}`);

  return {
    recovery,
    resumedState: resumed?.state,
    mainSkippedState: mainSkipped?.state,
    missingOriginState: missingOrigin?.state,
  };
}

async function runNotifierFallbackSmoke(tmpRoot) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  process.chdir(tmpRoot);

  const missingParentChatId = await findUnusedChatId();

  const [{ jobRunner }, { attachJobNotifier }] = await Promise.all([
    importDist('jobs/index.js'),
    importDist('discord/jobs/job-notifier.js'),
  ]);

  const sent = [];
  const fakeChannel = {
    send: async ({ content }) => {
      sent.push(String(content));
    },
    messages: {
      fetch: async () => ({
        edit: async () => {},
      }),
    },
  };
  const fakeClient = {
    channels: {
      fetch: async () => fakeChannel,
    },
  };

  attachJobNotifier(fakeClient);

  const childJobId = jobRunner.enqueue({
    name: 'smoke:child-handoff',
    lane: 'subagent',
    origin: { channelId: 'child-channel', userId: 'child-user' },
    parentJobId: 'parent-smoke-job',
    handoff: { mode: 'parent-session', parentChatId: missingParentChatId, platform: 'discord' },
    handler: async () => ({
      exitCode: 0,
      resultSummary: 'child delegated result',
      artifacts: ['artifact:a'],
    }),
  });

  await sleep(750);

  const child = jobRunner.get(childJobId);
  const rendered = sent.join('\n');

  assert(child?.state === 'succeeded', `child state=${child?.state}`);
  assert(sent.length > 0, 'expected notifier to send at least one message');
  assert(rendered.includes('Child agent'), 'expected raw child completion announcement');
  assert(rendered.includes('smoke:child-handoff'), 'expected child job name in announcement');
  assert(rendered.includes('subagent'), 'expected lane in announcement');

  return {
    childState: child?.state,
    sentChunks: sent.length,
    missingParentChatId,
    usedFallbackAnnouncement: rendered.includes('Child agent'),
  };
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudegram-delegation-smoke-'));
  const rehydration = await runRehydrationSmoke(path.join(tmpRoot, 'rehydration'));
  const notifierFallback = await runNotifierFallbackSmoke(path.join(tmpRoot, 'notifier'));

  console.log(
    JSON.stringify(
      {
        ok: true,
        rehydration,
        notifierFallback,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
