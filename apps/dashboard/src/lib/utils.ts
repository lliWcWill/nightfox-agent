import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DashboardEvent } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "..." : str;
}

// ── Event Description (shared by action-log + copy formatters) ──────

export function eventDescription(ev: DashboardEvent): string {
  const p = ev.payload;
  const durationMs =
    typeof p.durationMs === "number" && Number.isFinite(p.durationMs)
      ? p.durationMs
      : 0;
  const toolsUsed = Array.isArray(p.toolsUsed) ? p.toolsUsed.length : 0;

  switch (ev.type) {
    case "agent:start":
      return `Query started — ${truncate(String(p.prompt || ""), 100)}`;
    case "agent:tool_start":
      return `Tool: ${p.toolName}`;
    case "agent:tool_end":
      return `Tool completed`;
    case "agent:complete":
      return `Completed (${(durationMs / 1000).toFixed(1)}s) — ${toolsUsed} tools`;
    case "agent:error":
      return `Error: ${truncate(String(p.error || ""), 120)}`;
    case "voice:open":
      return `Gemini Live session opened`;
    case "voice:close":
      return `Voice session closed: ${p.reason}`;
    case "voice:text":
      return truncate(String(p.text || ""), 120);
    case "voice:tool_call":
      return `Voice tool: ${p.toolName}`;
    case "voice:tool_result":
      return `Tool completed: ${p.toolName}`;
    case "voice:interrupted":
      return `Barge-in detected`;
    case "voice:speaking":
      return `AI speaking`;
    case "voice:listening":
      return `Listening`;
    case "groq:start":
      return `Groq transcription started`;
    case "groq:complete":
      return truncate(String(p.text || ""), 120);
    case "groq:error":
      return `Transcription error: ${truncate(String(p.error || ""), 100)}`;
    case "droid:start":
      return `Droid started — ${truncate(String(p.prompt || ""), 100)}`;
    case "droid:complete":
      return `Droid finished (${(durationMs / 1000).toFixed(1)}s)`;
    case "queue:enqueue":
      return `Queued chat ${p.chatId} (depth: ${p.queueDepth})`;
    case "queue:dequeue":
      return `Dequeued chat ${p.chatId}`;
    case "queue:processing":
      return (p.isProcessing as boolean)
        ? `Processing chat ${p.chatId}`
        : `Chat ${p.chatId} is idle`;
    case "job:queued":
      return `Job queued — ${p.name} [${p.lane}]`;
    case "job:start":
      return `Job started — ${p.jobId}`;
    case "job:progress":
      return truncate(String(p.message || "Job progress"), 120);
    case "job:result":
      return truncate(String(p.summary || "Job produced a result"), 120);
    case "job:end":
      return `Job ${p.state} — ${truncate(String(p.jobId || ""), 18)}`;
    case "job:log":
      return truncate(String(p.message || "Job log"), 120);
    default:
      return ev.type;
  }
}

// ── Copy Helpers ────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function formatEventForCopy(ev: DashboardEvent): string {
  const time = formatTimestamp(ev.timestamp);
  const desc = eventDescription(ev);
  return `[${time}] ${ev.type}: ${desc}\n${JSON.stringify(ev.payload, null, 2)}`;
}

export function formatAllEventsForCopy(events: DashboardEvent[]): string {
  return events
    .map((ev) => {
      const time = formatTimestamp(ev.timestamp);
      return `[${time}] ${ev.type}: ${eventDescription(ev)}`;
    })
    .join("\n");
}
