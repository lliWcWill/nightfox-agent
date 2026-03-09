"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GlassPanel } from "@/components/glass/glass-panel";
import { useDashboardStore } from "@/hooks/use-store";
import {
  cn,
  formatDuration,
  formatStructuredValue,
  formatTimestamp,
  truncate,
} from "@/lib/utils";
import type { ToolCallInfo } from "@/lib/types";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  FolderOpen,
  Loader2,
  Maximize2,
  BookmarkPlus,
  Pencil,
  Search,
  Terminal,
  X,
  XCircle,
} from "lucide-react";

const TOOL_ICONS: Record<string, React.ElementType> = {
  Bash: Terminal,
  Read: FileText,
  Grep: Search,
  Glob: FolderOpen,
  Write: Pencil,
  Edit: Pencil,
  search_memory: Database,
  remember: BookmarkPlus,
  run_command: Terminal,
  ask_claude: Brain,
};

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.max(0, now - startedAt);

  return (
    <span className="font-mono text-[10px] text-status-thinking">
      {formatDuration(elapsed)}
    </span>
  );
}

function getToolCallSnippet(toolCall: ToolCallInfo): string {
  const source =
    toolCall.status === "running"
      ? toolCall.input
      : toolCall.output ?? toolCall.error ?? toolCall.input;
  const formatted = formatStructuredValue(source)
    .replace(/\s+/g, " ")
    .trim();
  return formatted ? truncate(formatted, 140) : "No tool detail captured yet";
}

function ToolPayloadBlock({
  label,
  value,
  emptyLabel,
  className,
}: {
  label: string;
  value: unknown;
  emptyLabel: string;
  className?: string;
}) {
  const formatted = formatStructuredValue(value);

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/60 uppercase">
          {label}
        </span>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded-xl bg-surface-0/60 p-3 font-mono text-[11px] whitespace-pre-wrap break-words text-foreground/80">
        {formatted || emptyLabel}
      </pre>
    </div>
  );
}

function ToolDetails({
  toolCall,
  large = false,
}: {
  toolCall: ToolCallInfo;
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-0 gap-3",
        large ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"
      )}
    >
      <ToolPayloadBlock
        label="Input"
        value={toolCall.input}
        emptyLabel="No input captured"
        className={large ? "min-h-[18rem]" : ""}
      />
      <ToolPayloadBlock
        label={toolCall.error ? "Error" : "Output"}
        value={toolCall.error ? toolCall.error : toolCall.output}
        emptyLabel={
          toolCall.status === "running"
            ? "Waiting for tool output..."
            : "No output captured"
        }
        className={large ? "min-h-[18rem]" : ""}
      />
    </div>
  );
}

function ToolCallCard({
  toolCall,
  expanded,
  onToggle,
  onInspect,
}: {
  toolCall: ToolCallInfo;
  expanded: boolean;
  onToggle: () => void;
  onInspect: () => void;
}) {
  const Icon = TOOL_ICONS[toolCall.toolName] || Terminal;
  const StatusIcon =
    toolCall.status === "running"
      ? Loader2
      : toolCall.status === "completed"
        ? CheckCircle2
        : XCircle;
  const statusColor =
    toolCall.status === "running"
      ? "text-status-thinking"
      : toolCall.status === "completed"
        ? "text-status-ready"
        : "text-status-error";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        "glass rounded-xl border border-border/40 transition-colors",
        expanded ? "bg-surface-2/75" : "bg-surface-1/70"
      )}
    >
      <div
        className="flex cursor-pointer items-start gap-3 px-3 py-3"
        onClick={onToggle}
      >
        <div className="mt-0.5 flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <StatusIcon
            className={cn(
              "h-3.5 w-3.5",
              statusColor,
              toolCall.status === "running" && "animate-spin"
            )}
          />
          <Icon className="h-3.5 w-3.5 text-agent-claude" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-foreground">
              {toolCall.toolName}
            </span>
            <span className="rounded-full bg-surface-0/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70">
              {toolCall.status}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {getToolCallSnippet(toolCall)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground/55">
            <span>started {formatTimestamp(toolCall.startedAt)}</span>
            {toolCall.completedAt ? (
              <span>{formatDuration(toolCall.completedAt - toolCall.startedAt)}</span>
            ) : (
              <ElapsedTimer startedAt={toolCall.startedAt} />
            )}
            {toolCall.callId && <span>call {truncate(toolCall.callId, 16)}</span>}
          </div>
        </div>

        <button
          type="button"
          title="Open larger detail view"
          onClick={(event) => {
            event.stopPropagation();
            onInspect();
          }}
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-surface-0/70 hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border/30"
          >
            <div className="px-3 py-3">
              <ToolDetails toolCall={toolCall} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ToolCalls() {
  const toolCalls = useDashboardStore((s) => s.toolCalls);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);

  const visibleCalls = useMemo(() => {
    const active = toolCalls
      .filter((toolCall) => toolCall.status === "running")
      .sort((a, b) => b.startedAt - a.startedAt);
    const recentCompleted = toolCalls
      .filter((toolCall) => toolCall.status !== "running")
      .sort(
        (a, b) =>
          (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt)
      )
      .slice(0, 24);

    return [...active, ...recentCompleted];
  }, [toolCalls]);

  const inspectedCall =
    visibleCalls.find((toolCall) => toolCall.id === inspectedId) ?? null;

  useEffect(() => {
    if (!inspectedCall) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInspectedId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectedCall]);

  return (
    <GlassPanel noPadding className="relative flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/30 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">Tool Calls</h3>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {visibleCalls.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/50">
            No tool calls yet
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {visibleCalls.map((toolCall) => (
                <ToolCallCard
                  key={toolCall.id}
                  toolCall={toolCall}
                  expanded={expandedId === toolCall.id}
                  onToggle={() =>
                    setExpandedId((current) =>
                      current === toolCall.id ? null : toolCall.id
                    )
                  }
                  onInspect={() => setInspectedId(toolCall.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {inspectedCall && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-3 z-20 flex min-h-0 flex-col rounded-2xl border border-border/50 bg-surface-1/95 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/30 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {inspectedCall.toolName}
                  </span>
                  <span className="rounded-full bg-surface-0/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {inspectedCall.status}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground/60">
                  started {formatTimestamp(inspectedCall.startedAt)}
                  {inspectedCall.completedAt
                    ? ` • ${formatDuration(
                        inspectedCall.completedAt - inspectedCall.startedAt
                      )}`
                    : ""}
                  {inspectedCall.callId
                    ? ` • call ${inspectedCall.callId}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedId(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-0/70 hover:text-foreground"
                title="Close detail view"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden p-4">
              <ToolDetails toolCall={inspectedCall} large />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassPanel>
  );
}
