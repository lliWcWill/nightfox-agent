"use client";

import { GlassBadge } from "@/components/glass/glass-badge";
import { GlassPanel } from "@/components/glass/glass-panel";
import { useDashboardStore } from "@/hooks/use-store";
import { API_URL } from "@/lib/constants";
import type {
  DashboardJobEventPage,
  DashboardJobLogPage,
  DashboardJobResultPayload,
} from "@/lib/types";
import { cn, formatDuration, formatStructuredValue, formatTimestamp, truncate } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function RuntimeValue({ startedAt, endedAt }: { startedAt?: number; endedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || endedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [endedAt, startedAt]);

  if (!startedAt) return <span>waiting</span>;
  const elapsed = endedAt ? Math.max(0, endedAt - startedAt) : Math.max(0, now - startedAt);
  return <span>{formatDuration(elapsed)}</span>;
}

function JobDetail({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [result, setResult] = useState<DashboardJobResultPayload | null>(null);
  const [logs, setLogs] = useState<DashboardJobLogPage | null>(null);
  const [events, setEvents] = useState<DashboardJobEventPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [resultRes, logsRes, eventsRes] = await Promise.all([
          fetch(`${API_URL}/api/jobs/${jobId}/result`),
          fetch(`${API_URL}/api/jobs/${jobId}/logs?limit=50`),
          fetch(`${API_URL}/api/jobs/${jobId}/events?limit=50`),
        ]);
        if (!resultRes.ok || !logsRes.ok || !eventsRes.ok) {
          throw new Error("Failed to load job details");
        }
        const [resultJson, logsJson, eventsJson] = await Promise.all([
          resultRes.json() as Promise<DashboardJobResultPayload>,
          logsRes.json() as Promise<DashboardJobLogPage>,
          eventsRes.json() as Promise<DashboardJobEventPage>,
        ]);
        if (cancelled) return;
        setResult(resultJson);
        setLogs(logsJson);
        setEvents(eventsJson);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load job details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function handleCancel() {
    setCanceling(true);
    try {
      await fetch(`${API_URL}/api/jobs/${jobId}/cancel`, { method: "POST" });
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50">
      <div className="flex h-full w-[720px] max-w-[100vw] flex-col border-l border-border/40 bg-surface-1 p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Job detail</h4>
            <p className="font-mono text-[11px] text-muted-foreground/60">{jobId}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              disabled={canceling}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300 disabled:opacity-50"
            >
              {canceling ? "Stopping..." : "Stop"}
            </button>
            <button onClick={onClose} className="rounded-md border border-border/40 px-3 py-1 text-xs text-muted-foreground">
              Close
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading job details…</div>
        ) : error ? (
          <div className="text-sm text-status-error">{error}</div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden xl:grid-cols-2">
            <GlassPanel className="min-h-0 overflow-auto">
              <h5 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">Result</h5>
              <div className="space-y-3 text-sm text-foreground">
                <div>
                  <div className="text-[11px] text-muted-foreground/60">Summary</div>
                  <div className="mt-1 whitespace-pre-wrap">{result?.resultSummary || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground/60">Delivery</div>
                  <div className="mt-1 font-mono text-xs">
                    {result?.delivery ? `${result.delivery.mode || "route"} → ${result.delivery.channelId || "?"}${result.delivery.threadId ? `#${result.delivery.threadId}` : ""}` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground/60">Artifacts</div>
                  <div className="mt-1 space-y-1 font-mono text-xs">
                    {(result?.artifacts || []).length === 0 ? "—" : result?.artifacts.map((artifact) => <div key={artifact}>{artifact}</div>)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground/60">Changed files</div>
                  <div className="mt-1 space-y-1 font-mono text-xs">
                    {(result?.changedFiles || []).length === 0 ? "—" : result?.changedFiles?.map((file) => <div key={file}>{file}</div>)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground/60">Child summaries</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-0/70 p-3 text-xs text-muted-foreground">{formatStructuredValue(result?.childSummaries || []) || "[]"}</pre>
                </div>
              </div>
            </GlassPanel>

            <div className="grid min-h-0 grid-rows-2 gap-4 overflow-hidden">
              <GlassPanel className="min-h-0 overflow-auto">
                <h5 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">Logs</h5>
                <div className="space-y-2 font-mono text-xs">
                  {(logs?.logs || []).length === 0 ? (
                    <div className="text-muted-foreground/50">No logs</div>
                  ) : (
                    logs?.logs.map((log, index) => (
                      <div key={`${log.at}-${index}`} className="rounded-md bg-surface-0/70 p-2">
                        <div className="text-[10px] text-muted-foreground/50">{formatTimestamp(log.at)} · {log.level}</div>
                        <div className="mt-1 whitespace-pre-wrap text-foreground">{log.message}</div>
                      </div>
                    ))
                  )}
                </div>
              </GlassPanel>

              <GlassPanel className="min-h-0 overflow-auto">
                <h5 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">Events</h5>
                <div className="space-y-2 font-mono text-xs">
                  {(events?.events || []).length === 0 ? (
                    <div className="text-muted-foreground/50">No events</div>
                  ) : (
                    events?.events.map((event, index) => (
                      <div key={`${String(event.type)}-${index}`} className="rounded-md bg-surface-0/70 p-2">
                        <div className="text-[10px] text-muted-foreground/50">{String(event.type)} · {formatTimestamp(Number((event as { at?: number }).at || Date.now()))}</div>
                        <pre className="mt-1 whitespace-pre-wrap text-foreground">{formatStructuredValue(event)}</pre>
                      </div>
                    ))
                  )}
                </div>
              </GlassPanel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({
  job,
  onOpen,
}: {
  job: ReturnType<typeof useDashboardStore.getState>["jobs"][number];
  onOpen: (jobId: string) => void;
}) {
  const stateClass = STATE_STYLES[job.state] ?? "text-muted-foreground";
  const laneColor = LANE_COLORS[job.lane] ?? "var(--muted-foreground)";

  return (
    <button onClick={() => onOpen(job.jobId)} className="glass w-full rounded-lg p-3 text-left transition hover:bg-surface-2/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GlassBadge color={laneColor}>{job.lane}</GlassBadge>
            <span className={cn("font-mono text-[11px] font-semibold", stateClass)}>{job.state}</span>
          </div>
          <div className="mt-2 text-sm font-semibold text-foreground">{truncate(job.name, 84)}</div>
          {job.progress && <div className="mt-1 text-[11px] text-muted-foreground">{truncate(job.progress, 120)}</div>}
          {!job.progress && job.resultSummary && <div className="mt-1 text-[11px] text-muted-foreground">{truncate(job.resultSummary, 120)}</div>}
          {!job.progress && !job.resultSummary && job.error && <div className="mt-1 text-[11px] text-status-error">{truncate(job.error, 120)}</div>}
        </div>
        <div className="shrink-0 text-right font-mono text-[10px] text-muted-foreground/60">
          <div><RuntimeValue startedAt={job.startedAt} endedAt={job.endedAt} /></div>
          <div className="mt-1">{formatTimestamp(job.endedAt ?? job.startedAt ?? job.createdAt)}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/55">
        <span>ID {job.jobId.slice(0, 8)}</span>
        {job.parentJobId && <span>parent {job.parentJobId.slice(0, 8)}</span>}
        {job.origin?.channelId && <span>channel {job.origin.channelId}</span>}
        {job.artifacts && job.artifacts.length > 0 && <span>{job.artifacts.length} artifacts</span>}
      </div>
    </button>
  );
}

export function JobRuns() {
  const jobs = useDashboardStore((s) => s.jobs);
  const metrics = useDashboardStore((s) => s.jobMetrics);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const active = useMemo(() => jobs.filter((job) => job.state === "queued" || job.state === "running"), [jobs]);
  const recent = useMemo(() => jobs.filter((job) => job.state !== "queued" && job.state !== "running").slice(0, 8), [jobs]);

  return (
    <>
      <GlassPanel className="flex h-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Fleet Jobs</h3>
            <p className="mt-1 text-[11px] text-muted-foreground/60">Live background work, recent completions, and pressure signals.</p>
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
              <span className="font-mono text-[10px] text-muted-foreground/50">{active.length}</span>
            </div>
            <div className="min-h-0 space-y-2 overflow-auto pr-1">
              {active.length === 0 ? (
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/40 text-[11px] text-muted-foreground/40">No active jobs</div>
              ) : (
                active.map((job) => <JobRow key={job.jobId} job={job} onOpen={setSelectedJobId} />)
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Recent</span>
              <span className="font-mono text-[10px] text-muted-foreground/50">{recent.length}</span>
            </div>
            <div className="min-h-0 space-y-2 overflow-auto pr-1">
              {recent.length === 0 ? (
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/40 text-[11px] text-muted-foreground/40">No completed jobs yet</div>
              ) : (
                recent.map((job) => <JobRow key={job.jobId} job={job} onOpen={setSelectedJobId} />)
              )}
            </div>
          </div>
        </div>
      </GlassPanel>
      {selectedJobId && <JobDetail jobId={selectedJobId} onClose={() => setSelectedJobId(null)} />}
    </>
  );
}
