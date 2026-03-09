"use client";

import { create } from "zustand";
import type {
  AgentId,
  AgentStatusInfo,
  DashboardEvent,
  DashboardJobInfo,
  DashboardJobMetrics,
  FleetSummary,
  KanbanTask,
  QueueInfo,
  ToolCallInfo,
  WsMessage,
} from "@/lib/types";

const MAX_EVENTS = 500;

function upsertQueueList(queues: QueueInfo[], next: QueueInfo): QueueInfo[] {
  const filtered = queues.filter((queue) => queue.chatId !== next.chatId);
  if (next.depth <= 0 && !next.isProcessing) {
    return filtered;
  }
  return [next, ...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
}

function upsertJobList(jobs: DashboardJobInfo[], next: DashboardJobInfo): DashboardJobInfo[] {
  return [next, ...jobs.filter((job) => job.jobId !== next.jobId)]
    .sort((a, b) => {
      const aTime = a.endedAt ?? a.startedAt ?? a.createdAt;
      const bTime = b.endedAt ?? b.startedAt ?? b.createdAt;
      return bTime - aTime;
    })
    .slice(0, MAX_EVENTS);
}

interface DashboardState {
  agents: Record<AgentId, AgentStatusInfo>;
  updateAgent: (id: AgentId, patch: Partial<AgentStatusInfo>) => void;

  events: DashboardEvent[];
  addEvent: (event: DashboardEvent) => void;

  toolCalls: ToolCallInfo[];
  addToolCall: (tc: ToolCallInfo) => void;
  completeToolCall: (chatId: number | string) => void;

  queues: QueueInfo[];
  jobs: DashboardJobInfo[];
  jobMetrics?: DashboardJobMetrics;
  bootstrapFleet: (summary: FleetSummary) => void;
  upsertQueue: (queue: QueueInfo) => void;
  upsertJob: (job: DashboardJobInfo) => void;

  clearEvents: () => void;
  clearToolCalls: () => void;

  kanbanTasks: KanbanTask[];
  kanbanFilter: AgentId | "all";
  setKanbanFilter: (filter: AgentId | "all") => void;
  setKanbanTasks: (tasks: KanbanTask[]) => void;

  activePanel: string;
  setActivePanel: (panel: string) => void;
  autoScroll: boolean;
  toggleAutoScroll: () => void;
  eventFilter: string;
  setEventFilter: (filter: string) => void;

  processMessage: (msg: WsMessage) => void;
}

function getPayloadTimestamp(payload: Record<string, unknown>): number {
  for (const key of ["timestamp", "at"] as const) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return Date.now();
}

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  agents: {
    claude: { id: "claude", status: "offline" },
    gemini: { id: "gemini", status: "offline" },
    droid: { id: "droid", status: "offline" },
    groq: { id: "groq", status: "offline" },
  },

  updateAgent: (id, patch) =>
    set((state) => ({
      agents: {
        ...state.agents,
        [id]: { ...state.agents[id], ...patch },
      },
    })),

  events: [],
  addEvent: (event) =>
    set((state) => ({
      events: [...state.events, event].slice(-MAX_EVENTS),
    })),

  toolCalls: [],
  addToolCall: (tc) =>
    set((state) => ({
      toolCalls: [...state.toolCalls, tc],
    })),
  completeToolCall: (chatId) =>
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        String(tc.chatId) === String(chatId) && tc.status === "running"
          ? { ...tc, status: "completed" as const, completedAt: Date.now() }
          : tc
      ),
    })),

  queues: [],
  jobs: [],
  jobMetrics: undefined,
  bootstrapFleet: (summary) =>
    set((state) => ({
      agents: summary.agents.reduce(
        (acc, agent) => ({ ...acc, [agent.id]: agent }),
        state.agents
      ),
      queues: summary.queues,
      jobs: summary.jobs.recent,
      jobMetrics: summary.jobs.metrics,
    })),
  upsertQueue: (queue) =>
    set((state) => ({
      queues: upsertQueueList(state.queues, queue),
    })),
  upsertJob: (job) =>
    set((state) => ({
      jobs: upsertJobList(state.jobs, job),
    })),

  clearEvents: () => set({ events: [] }),
  clearToolCalls: () =>
    set((state) => ({
      toolCalls: state.toolCalls.filter((tc) => tc.status === "running"),
    })),

  kanbanTasks: [],
  kanbanFilter: "all",
  setKanbanFilter: (filter) => set({ kanbanFilter: filter }),
  setKanbanTasks: (tasks) => set({ kanbanTasks: tasks }),

  activePanel: "fleet",
  setActivePanel: (panel) => set({ activePanel: panel }),
  autoScroll: true,
  toggleAutoScroll: () => set((state) => ({ autoScroll: !state.autoScroll })),
  eventFilter: "",
  setEventFilter: (filter) => set({ eventFilter: filter }),

  processMessage: (msg) => {
    const { type, payload } = msg;
    const ts = getPayloadTimestamp(payload);
    const state = get();

    state.addEvent({
      id: `${type}_${ts}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      payload,
      timestamp: ts,
    });

    switch (type) {
      case "agent:start":
        state.updateAgent("claude", {
          status: "thinking",
          model: payload.model as string,
          currentActivity: (payload.prompt as string)?.slice(0, 80),
          lastActivity: ts,
        });
        break;

      case "agent:tool_start":
        state.addToolCall({
          id: `tool_${ts}_${Math.random().toString(36).slice(2, 6)}`,
          chatId: payload.chatId as number,
          toolName: payload.toolName as string,
          input: payload.input as Record<string, unknown>,
          status: "running",
          startedAt: ts,
        });
        break;

      case "agent:tool_end":
        state.completeToolCall(payload.chatId as number);
        break;

      case "agent:complete":
        state.updateAgent("claude", {
          status: "ready",
          currentActivity: undefined,
          lastActivity: ts,
        });
        break;

      case "agent:error":
        state.updateAgent("claude", {
          status: "error",
          currentActivity: (payload.error as string)?.slice(0, 80),
          lastActivity: ts,
        });
        break;

      case "voice:open":
        state.updateAgent("gemini", { status: "ready", lastActivity: ts });
        break;

      case "voice:close":
        state.updateAgent("gemini", {
          status: "offline",
          currentActivity: undefined,
        });
        break;

      case "voice:text":
        state.updateAgent("gemini", {
          currentActivity: (payload.text as string)?.slice(0, 80),
          lastActivity: ts,
        });
        break;

      case "voice:tool_call":
        state.updateAgent("gemini", {
          status: "thinking",
          currentActivity: `Tool: ${payload.toolName}`,
          lastActivity: ts,
        });
        state.addToolCall({
          id: `vtool_${ts}_${Math.random().toString(36).slice(2, 6)}`,
          chatId: (payload.chatId as number) ?? "voice",
          toolName: payload.toolName as string,
          input:
            (payload.input as Record<string, unknown>) ??
            (payload.args as Record<string, unknown>),
          status: "running",
          startedAt: ts,
        });
        break;

      case "voice:interrupted":
        state.updateAgent("gemini", {
          status: "ready",
          currentActivity: "Interrupted",
          lastActivity: ts,
        });
        break;

      case "droid:start":
        state.updateAgent("droid", {
          status: "thinking",
          model: payload.model as string,
          currentActivity: (payload.prompt as string)?.slice(0, 80),
          lastActivity: ts,
        });
        break;

      case "droid:complete":
        state.updateAgent("droid", {
          status: (payload.isError as boolean) ? "error" : "ready",
          currentActivity: undefined,
          lastActivity: ts,
        });
        break;

      case "queue:enqueue":
        state.upsertQueue({
          chatId: payload.chatId as number,
          depth: payload.queueDepth as number,
          isProcessing: false,
          lastMessage: payload.message as string | undefined,
          updatedAt: ts,
        });
        break;

      case "queue:dequeue": {
        const existing = state.queues.find((queue) => queue.chatId === payload.chatId);
        state.upsertQueue({
          chatId: payload.chatId as number,
          depth: Math.max(0, (existing?.depth ?? 1) - 1),
          isProcessing: existing?.isProcessing ?? false,
          lastMessage: existing?.lastMessage,
          updatedAt: ts,
        });
        break;
      }

      case "queue:processing": {
        const existing = state.queues.find((queue) => queue.chatId === payload.chatId);
        state.upsertQueue({
          chatId: payload.chatId as number,
          depth: existing?.depth ?? 0,
          isProcessing: Boolean(payload.isProcessing),
          lastMessage: existing?.lastMessage,
          updatedAt: ts,
        });
        break;
      }

      case "job:queued":
        state.upsertJob({
          jobId: payload.jobId as string,
          name: payload.name as string,
          lane: payload.lane as DashboardJobInfo["lane"],
          state: "queued",
          createdAt: ts,
          parentJobId: payload.parentJobId as string | undefined,
          rootJobId: (payload.rootJobId as string) || (payload.jobId as string),
        });
        break;

      case "job:start": {
        const existing = state.jobs.find((job) => job.jobId === payload.jobId);
        state.upsertJob({
          jobId: payload.jobId as string,
          name: existing?.name || "Job",
          lane: (payload.lane as DashboardJobInfo["lane"]) || existing?.lane || "main",
          state: "running",
          createdAt: existing?.createdAt || ts,
          startedAt: ts,
          parentJobId: existing?.parentJobId,
          rootJobId: existing?.rootJobId || (payload.jobId as string),
          progress: existing?.progress,
          resultSummary: existing?.resultSummary,
          error: existing?.error,
          origin: existing?.origin,
        });
        break;
      }

      case "job:origin": {
        const existing = state.jobs.find((job) => job.jobId === payload.jobId);
        if (existing) {
          state.upsertJob({
            ...existing,
            origin: payload.origin as DashboardJobInfo["origin"],
          });
        }
        break;
      }

      case "job:progress": {
        const existing = state.jobs.find((job) => job.jobId === payload.jobId);
        if (existing) {
          state.upsertJob({
            ...existing,
            progress: payload.message as string,
          });
        }
        break;
      }

      case "job:result": {
        const existing = state.jobs.find((job) => job.jobId === payload.jobId);
        if (existing) {
          state.upsertJob({
            ...existing,
            resultSummary: payload.summary as string | undefined,
          });
        }
        break;
      }

      case "job:end": {
        const existing = state.jobs.find((job) => job.jobId === payload.jobId);
        state.upsertJob({
          jobId: payload.jobId as string,
          name: existing?.name || "Job",
          lane: existing?.lane || "main",
          state: payload.state as DashboardJobInfo["state"],
          createdAt: existing?.createdAt || ts,
          startedAt: existing?.startedAt,
          endedAt: ts,
          parentJobId: existing?.parentJobId,
          rootJobId: existing?.rootJobId || (payload.jobId as string),
          progress: existing?.progress,
          resultSummary: existing?.resultSummary,
          error:
            (payload.state as string) === "succeeded"
              ? undefined
              : existing?.error || `Job ${payload.state}`,
          origin: existing?.origin,
        });
        break;
      }
    }
  },
}));
