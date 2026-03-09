"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GlassPanel } from "@/components/glass/glass-panel";
import { useDashboardStore } from "@/hooks/use-store";
import { cn, formatDuration, truncate } from "@/lib/utils";
import {
  Terminal,
  FileText,
  Search,
  FolderOpen,
  Pencil,
  CheckCircle2,
  Loader2,
  XCircle,
  Brain,
  Database,
  BookmarkPlus,
} from "lucide-react";

const TOOL_ICONS: Record<string, React.ElementType> = {
  Bash: Terminal,
  Read: FileText,
  Grep: Search,
  Glob: FolderOpen,
  Write: Pencil,
  Edit: Pencil,
  // Gemini voice tools
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
  }, [startedAt]);

  const elapsed = Math.max(0, now - startedAt);

  return (
    <span className="font-mono text-[10px] text-status-thinking">
      {formatDuration(elapsed)}
    </span>
  );
}

export function ToolCalls() {
  const toolCalls = useDashboardStore((s) => s.toolCalls);

  // Show active + last 10 completed
  const active = toolCalls.filter((tc) => tc.status === "running");
  const completed = toolCalls
    .filter((tc) => tc.status !== "running")
    .slice(-10)
    .reverse();

  return (
    <GlassPanel noPadding className="flex h-full flex-col">
      <div className="border-b border-border/30 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">Tool Calls</h3>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {active.length === 0 && completed.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/50">
            No tool calls yet
          </div>
        ) : (
          <div className="space-y-2">
            {/* Active tool calls */}
            <AnimatePresence mode="popLayout">
              {active.map((tc) => {
                const Icon = TOOL_ICONS[tc.toolName] || Terminal;
                return (
                  <motion.div
                    key={tc.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="glass rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{
                            duration: 1,
                            repeat: Infinity,
                            ease: "linear",
                          }}
                        >
                          <Loader2 className="h-3.5 w-3.5 text-status-thinking" />
                        </motion.div>
                        <Icon className="h-3.5 w-3.5 text-agent-claude" />
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {tc.toolName}
                        </span>
                      </div>
                      <ElapsedTimer startedAt={tc.startedAt} />
                    </div>

                    {tc.input && (
                      <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                        {tc.input.command
                          ? truncate(String(tc.input.command), 80)
                          : tc.input.pattern
                            ? truncate(String(tc.input.pattern), 80)
                            : tc.input.file_path
                              ? truncate(String(tc.input.file_path), 80)
                              : ""}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Completed tool calls */}
            {completed.length > 0 && (
              <div className="space-y-1 pt-1">
                {active.length > 0 && (
                  <div className="px-1 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
                    Recent
                  </div>
                )}
                {completed.map((tc) => {
                  const Icon = TOOL_ICONS[tc.toolName] || Terminal;
                  const StatusIcon =
                    tc.status === "completed" ? CheckCircle2 : XCircle;
                  const statusColor =
                    tc.status === "completed"
                      ? "text-status-ready"
                      : "text-status-error";

                  return (
                    <div
                      key={tc.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 opacity-60"
                    >
                      <StatusIcon className={cn("h-3 w-3", statusColor)} />
                      <Icon className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {tc.toolName}
                      </span>
                      {tc.completedAt && (
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground/40">
                          {formatDuration(tc.completedAt - tc.startedAt)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
