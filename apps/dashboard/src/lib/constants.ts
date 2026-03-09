import { Brain, Mic, Bot, Zap } from "lucide-react";
import type { AgentId, KanbanColumn } from "./types";

export const AGENT_ICONS: Record<AgentId, React.ElementType> = {
  claude: Brain,
  gemini: Mic,
  droid: Bot,
  groq: Zap,
};

export const VALID_KANBAN_COLUMNS: KanbanColumn[] = [
  "todo",
  "in_progress",
  "done",
  "archived",
];

export const VALID_AGENT_IDS: AgentId[] = ["claude", "gemini", "droid", "groq"];

export const AGENTS: Record<
  AgentId,
  { label: string; color: string; glowClass: string; description: string }
> = {
  claude: {
    label: "Nightfox Core",
    color: "var(--agent-claude)",
    glowClass: "glow-claude",
    description: "Primary orchestrator",
  },
  gemini: {
    label: "Voice",
    color: "var(--agent-gemini)",
    glowClass: "glow-gemini",
    description: "Voice runtime",
  },
  droid: {
    label: "Droid",
    color: "var(--agent-droid)",
    glowClass: "glow-droid",
    description: "Autonomous worker",
  },
  groq: {
    label: "Transcribe",
    color: "var(--agent-groq)",
    glowClass: "glow-groq",
    description: "Speech transcription",
  },
};

export const EVENT_COLORS: Record<string, string> = {
  "agent:start": "var(--agent-claude)",
  "agent:progress": "var(--agent-claude)",
  "agent:tool_start": "var(--agent-claude)",
  "agent:tool_end": "var(--agent-claude)",
  "agent:complete": "var(--agent-claude)",
  "agent:error": "var(--status-error)",
  "voice:open": "var(--agent-gemini)",
  "voice:close": "var(--agent-gemini)",
  "voice:text": "var(--agent-gemini)",
  "voice:tool_call": "var(--agent-gemini)",
  "voice:tool_result": "var(--agent-gemini)",
  "voice:interrupted": "var(--agent-gemini)",
  "voice:speaking": "var(--agent-gemini)",
  "voice:listening": "var(--agent-gemini)",
  "groq:start": "var(--agent-groq)",
  "groq:complete": "var(--agent-groq)",
  "groq:error": "var(--status-error)",
  "droid:start": "var(--agent-droid)",
  "droid:stream": "var(--agent-droid)",
  "droid:complete": "var(--agent-droid)",
  "session:create": "var(--muted)",
  "session:update": "var(--muted)",
  "session:clear": "var(--muted)",
  "queue:enqueue": "var(--muted)",
  "queue:dequeue": "var(--muted)",
  "queue:processing": "var(--muted)",
  "job:queued": "var(--agent-droid)",
  "job:start": "var(--status-thinking)",
  "job:progress": "var(--agent-gemini)",
  "job:result": "var(--agent-claude)",
  "job:end": "var(--status-ready)",
  "job:log": "var(--muted)",
  "job:origin": "var(--muted)",
  "job:idempotency": "var(--muted)",
  "task:create": "var(--agent-claude)",
  "task:update": "var(--agent-claude)",
};

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3011/ws";
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3011";
