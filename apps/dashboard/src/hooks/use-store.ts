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
const MAX_TOOL_CALLS = 200;

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

function upsertToolCallList(toolCalls: ToolCallInfo[], next: ToolCallInfo): ToolCallInfo[] {
  if (next.callId) {
    const existingIndex = toolCalls.findIndex((tc) => tc.callId === next.callId);
    if (existingIndex !== -1) {
      const updated = [...toolCalls];
      updated[existingIndex] = { ...updated[existingIndex], ...next };
      return updated.slice(-MAX_TOOL_CALLS);
    }
  }

  return [...toolCalls, next].slice(-MAX_TOOL_CALLS);
}

interface ToolCallCompletion {
  chatId: number | string;
  toolName?: string;
  callId?: string;
  output?: unknown;
  error?: string;
  status?: ToolCallInfo["status"];
  completedAt?: number;
}

function findToolCallIndex(toolCalls: ToolCallInfo[], completion: ToolCallCompletion): number {
  let fallbackIndex = -1;

  if (completion.callId) {
    for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
      if (toolCalls[i]?.callId === completion.callId) {
        if (toolCalls[i]?.status === "running") {
          return i;
        }
        if (fallbackIndex === -1) {
          fallbackIndex = i;
        }
      }
    }
  }

  for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
    const toolCall = toolCalls[i];
    if (!toolCall || String(toolCall.chatId) !== String(completion.chatId)) {
      continue;
    }

    if (
      completion.toolName &&
      toolCall.toolName &&
      toolCall.toolName !== completion.toolName
    ) {
      continue;
    }

    if (toolCall.status === "running") {
      return i;
    }

    if (fallbackIndex === -1) {
      fallbackIndex = i;
    }
  }

  return fallbackIndex;
}

interface DashboardState {
  agents: Record<AgentId, AgentStatusInfo>;
  updateAgent: (id: AgentId, patch: Partial<AgentStatusInfo>) => void;

  events: DashboardEvent[];
  addEvent: (event: DashboardEvent) => void;

  toolCalls: ToolCallInfo[];
  addToolCall: (tc: ToolCallInfo) => void;
  completeToolCall: (completion: ToolCallCompletion) => void;

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
  selectedJobId: string | null;
  setSelectedJobId: (jobId: string | null) => void;
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
      toolCalls: upsertToolCallList(state.toolCalls, tc),
    })),
  completeToolCall: (completion) =>
    set((state) => {
      const index = findToolCallIndex(state.toolCalls, completion);
      const completedAt = completion.completedAt ?? Date.now();
      const nextStatus =
        completion.status ?? (completion.error ? "error" : "completed");

      if (index === -1) {
        return {
          toolCalls: upsertToolCallList(state.toolCalls, {
            id:
              completion.callId ??
              `tool_${completedAt}_${Math.random().toString(36).slice(2, 6)}`,
            callId: completion.callId,
            chatId: completion.chatId,
            toolName: completion.toolName || "unknown",
            input: undefined,
            output: completion.output,
            error: completion.error,
            status: nextStatus,
            startedAt: completedAt,
            completedAt,
          }),
        };
      }

      const nextToolCalls = [...state.toolCalls];
      const existing = nextToolCalls[index];
      nextToolCalls[index] = {
        ...existing,
        callId: completion.callId ?? existing.callId,
        toolName: completion.toolName || existing.toolName,
        output: completion.output ?? existing.output,
        error: completion.error ?? existing.error,
        status: nextStatus,
        completedAt,
      };

      return { toolCalls: nextToolCalls };
    }),

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
  selectedJobId: null,
  setSelectedJobId: (jobId) => set({ selectedJobId: jobId }),
  autoScroll: true,
  toggleAutoScroll: () => set((state) => ({ autoScroll: !state.autoScroll })),
  eventFilter: "",
  setEventFilter: (filter) => set({ eventFilter: filter }),

  processMessage: (msg) => {
    const { type, payload } = msg;
    if (type === "system:hello" || type === "system:heartbeat") {
      return;
    }
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
            id:
              (payload.callId as string | undefined) ??
              `tool_${ts}_${Math.random().toString(36).slice(2, 6)}`,
            chatId: payload.chatId as number,
            toolName: payload.toolName as string,
            callId: payload.callId as string | undefined,
            input: payload.input as Record<string, unknown>,
            status: "running",
            startedAt: ts,
          });
          break;

        case "agent:tool_end":
          state.completeToolCall({
            chatId: payload.chatId as number,
            toolName: payload.toolName as string | undefined,
            callId: payload.callId as string | undefined,
            output: payload.output,
            error: payload.error as string | undefined,
            status:
              payload.status === "error" || payload.error
                ? "error"
                : "completed",
            completedAt: ts,
          });
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
          state.completeToolCall({
            chatId: payload.chatId as number,
            error: payload.error as string | undefined,
            status: "error",
            completedAt: ts,
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

        case "voice:tool_call": {
          const voiceToolId = `vtool_${ts}_${Math.random().toString(36).slice(2, 6)}`;
          state.updateAgent("gemini", {
            status: "thinking",
            currentActivity: `Tool: ${payload.toolName}`,
            lastActivity: ts,
          });
          state.addToolCall({
            id: voiceToolId,
            chatId: (payload.chatId as number) ?? "voice",
            toolName: payload.toolName as string,
            callId: payload.callId as string | undefined,
            input:
              (payload.input as Record<string, unknown>) ??
              (payload.args as Record<string, unknown>),
            status: "running",
            startedAt: ts,
          });
          // Voice tool calls complete immediately (fire-and-forget from Gemini Live)
          // — auto-complete after a short synthetic delay so the UI shows the call then resolves.
          state.completeToolCall({
            chatId: (payload.chatId as number) ?? "voice",
            toolName: payload.toolName as string,
            callId: payload.callId as string | undefined,
            output: (payload.result as Record<string, unknown>) ?? undefined,
            status: "completed",
            completedAt: ts + 1,
          });
          break;
        }

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
        if (state.jobMetrics) {
          const m = state.jobMetrics;
          set({ jobMetrics: { ...m, totalQueued: m.totalQueued + 1, queueDepth: m.queueDepth + 1, peakQueueDepth: Math.max(m.peakQueueDepth, m.queueDepth + 1) } });
        }
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
        if (state.jobMetrics) {
          const m = state.jobMetrics;
          set({ jobMetrics: { ...m, totalStarted: m.totalStarted + 1, queueDepth: Math.max(0, m.queueDepth - 1), running: true } });
        }
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
        const endState = payload.state as string;
        state.upsertJob({
          jobId: payload.jobId as string,
          name: existing?.name || "Job",
          lane: existing?.lane || "main",
          state: endState as DashboardJobInfo["state"],
          createdAt: existing?.createdAt || ts,
          startedAt: existing?.startedAt,
          endedAt: ts,
          parentJobId: existing?.parentJobId,
          rootJobId: existing?.rootJobId || (payload.jobId as string),
          progress: existing?.progress,
          resultSummary: existing?.resultSummary,
          error:
            endState === "succeeded"
              ? undefined
              : existing?.error || `Job ${endState}`,
          origin: existing?.origin,
        });
        if (state.jobMetrics) {
          const m = state.jobMetrics;
          const patch: Partial<DashboardJobMetrics> = { totalEnded: m.totalEnded + 1 };
          if (endState === "succeeded") patch.totalSucceeded = m.totalSucceeded + 1;
          else if (endState === "failed") patch.totalFailed = m.totalFailed + 1;
          else if (endState === "canceled") patch.totalCanceled = m.totalCanceled + 1;
          else if (endState === "timeout") patch.totalTimeout = m.totalTimeout + 1;
          set({ jobMetrics: { ...m, ...patch } });
        }
        break;
      }
    }
  },
}));
