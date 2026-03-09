"use client";

import { GlassBadge } from "@/components/glass/glass-badge";
import { GlassPanel } from "@/components/glass/glass-panel";
import { useDashboardStore } from "@/hooks/use-store";
import { cn, formatDuration, formatTimestamp, truncate } from "@/lib/utils";
import { useEffect, useState } from "react";

const LANE_COLORS = {
  main: "var(--agent-claude)",
  subagent: "var(--agent-droid)",
  review: "var(--agent-gemini)",
  maintenance: "var(--agent-groq)",
} as const;

const STATE_STYLES = {
  queued: "text-muted-foreground",
  running: "text-status-thinking",
  succeeded: "text-status-ready",
  failed: "text-status-error",
  canceled: "text-muted-foreground",
  timeout: "text-status-error",
} as const;

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="glass rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

function RuntimeValue({
  startedAt,
  endedAt,
}: {
  startedAt?: number;
  endedAt?: number;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || endedAt) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [endedAt, startedAt]);

  if (!startedAt) {
    return <span>waiting</span>;
  }

  const elapsed = endedAt
    ? Math.max(0, endedAt - startedAt)
    : Math.max(0, now - startedAt);

  return <span>{formatDuration(elapsed)}</span>;
}

function JobRow({
  job,
}: {
  job: ReturnType<typeof useDashboardStore.getState>["jobs"][number];
}) {
  const stateClass = STATE_STYLES[job.state];
  const laneColor = LANE_COLORS[job.lane];

  return (
    <div className="glass rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GlassBadge color={laneColor}>{job.lane}</GlassBadge>
            <span className={cn("font-mono text-[11px] font-semibold", stateClass)}>
              {job.state}
            </span>
          </div>
          <div className="mt-2 text-sm font-semibold text-foreground">
            {truncate(job.name, 84)}
          </div>
          {job.progress && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {truncate(job.progress, 120)}
            </div>
          )}
          {!job.progress && job.resultSummary && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {truncate(job.resultSummary, 120)}
            </div>
          )}
          {!job.progress && !job.resultSummary && job.error && (
            <div className="mt-1 text-[11px] text-status-error">
              {truncate(job.error, 120)}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] text-muted-foreground/60">
          <div>
            <RuntimeValue startedAt={job.startedAt} endedAt={job.endedAt} />
          </div>
          <div className="mt-1">{formatTimestamp(job.endedAt ?? job.startedAt ?? job.createdAt)}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/55">
        <span>ID {job.jobId.slice(0, 8)}</span>
        {job.parentJobId && <span>parent {job.parentJobId.slice(0, 8)}</span>}
        {job.origin?.channelId && <span>channel {job.origin.channelId}</span>}
      </div>
    </div>
  );
}

export function JobRuns() {
  const jobs = useDashboardStore((s) => s.jobs);
  const metrics = useDashboardStore((s) => s.jobMetrics);

  const active = jobs.filter((job) => job.state === "queued" || job.state === "running");
  const recent = jobs.filter((job) => job.state !== "queued" && job.state !== "running").slice(0, 8);

  return (
    <GlassPanel className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Fleet Jobs</h3>
          <p className="mt-1 text-[11px] text-muted-foreground/60">
            Live background work, recent completions, and pressure signals.
          </p>
        </div>
        {metrics && (
          <div className="grid grid-cols-4 gap-2">
            <Metric label="Queued" value={metrics.queueDepth} />
            <Metric label="Succeeded" value={metrics.totalSucceeded} />
            <Metric label="Failed" value={metrics.totalFailed + metrics.totalTimeout} />
            <Metric label="Run P95" value={formatDuration(Math.round(metrics.runP95Ms || 0))} />
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Active</span>
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {active.length}
            </span>
          </div>
          <div className="min-h-0 space-y-2 overflow-auto pr-1">
            {active.length === 0 ? (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/40 text-[11px] text-muted-foreground/40">
                No active jobs
              </div>
            ) : (
              active.map((job) => <JobRow key={job.jobId} job={job} />)
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Recent</span>
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {recent.length}
            </span>
          </div>
          <div className="min-h-0 space-y-2 overflow-auto pr-1">
            {recent.length === 0 ? (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/40 text-[11px] text-muted-foreground/40">
                No completed jobs yet
              </div>
            ) : (
              recent.map((job) => <JobRow key={job.jobId} job={job} />)
            )}
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
