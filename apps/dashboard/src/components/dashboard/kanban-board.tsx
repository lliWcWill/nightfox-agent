"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { GlassPanel } from "@/components/glass/glass-panel";
import { GlassBadge } from "@/components/glass/glass-badge";
import { useDashboardStore } from "@/hooks/use-store";
import { AGENTS, AGENT_ICONS } from "@/lib/constants";
import { cn, formatTimestamp, truncate } from "@/lib/utils";
import type { AgentId, KanbanColumn, KanbanTask } from "@/lib/types";
import {
  CircleDot,
  Loader2,
  CheckCircle2,
  Archive,
  TriangleAlert,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Tag,
} from "lucide-react";

// ── Column config ────────────────────────────────────────────────────

const COLUMNS: {
  id: KanbanColumn;
  label: string;
  icon: React.ElementType;
  accentVar: string;
}[] = [
  { id: "todo", label: "To Do", icon: CircleDot, accentVar: "var(--muted-foreground)" },
  { id: "in_progress", label: "In Progress", icon: Loader2, accentVar: "var(--status-thinking)" },
  { id: "done", label: "Done", icon: CheckCircle2, accentVar: "var(--status-ready)" },
  { id: "archived", label: "Archived", icon: Archive, accentVar: "var(--muted-foreground)" },
];

const PRIORITY_CONFIG: Record<
  NonNullable<KanbanTask["priority"]>,
  { icon: React.ElementType; color: string; label: string }
> = {
  critical: { icon: TriangleAlert, color: "var(--status-error)", label: "Crit" },
  high: { icon: ArrowUp, color: "var(--status-error)", label: "High" },
  medium: { icon: ArrowRight, color: "var(--status-thinking)", label: "Med" },
  low: { icon: ArrowDown, color: "var(--muted-foreground)", label: "Low" },
};

const FILTER_TABS: { id: AgentId | "all"; label: string }[] = [
  { id: "all", label: "All" },
  ...Object.entries(AGENTS).map(([id, agent]) => ({
    id: id as AgentId,
    label: agent.label,
  })),
];

// ── Task Card ────────────────────────────────────────────────────────

function TaskCard({ task }: { task: KanbanTask }) {
  const agentConfig = AGENTS[task.agent];
  const AgentIcon = AGENT_ICONS[task.agent];
  const priority = task.priority ? PRIORITY_CONFIG[task.priority] : null;
  const PriorityIcon = priority?.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="glass group relative rounded-lg p-3 transition-colors hover:border-border-hover"
    >
      {/* Agent accent line */}
      <div
        className="absolute top-0 left-3 right-3 h-px opacity-40"
        style={{ background: agentConfig.color }}
      />

      {/* Header: agent + priority */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <AgentIcon
            className="h-3 w-3"
            style={{ color: agentConfig.color }}
          />
          <span
            className="text-[10px] font-medium"
            style={{ color: agentConfig.color }}
          >
            {agentConfig.label}
          </span>
        </div>
        {priority && PriorityIcon && (
          <div className="flex items-center gap-1">
            <PriorityIcon
              className="h-3 w-3"
              style={{ color: priority.color }}
            />
            <span
              className="text-[10px] font-medium"
              style={{ color: priority.color }}
            >
              {priority.label}
            </span>
          </div>
        )}
      </div>

      {/* Title */}
      <div className="mt-2 text-xs font-semibold leading-snug text-foreground">
        {truncate(task.title, 60)}
      </div>

      {/* Description */}
      {task.description && (
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {truncate(task.description, 100)}
        </div>
      )}

      {/* Labels + timestamp */}
      <div className="mt-2.5 flex items-center gap-1.5">
        {task.labels?.slice(0, 3).map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-0.5 rounded-md bg-surface-2/80 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
          >
            <Tag className="h-2 w-2" />
            {label}
          </span>
        ))}
        <span className="ml-auto font-mono text-[9px] text-muted-foreground/40">
          {formatTimestamp(task.updatedAt)}
        </span>
      </div>
    </motion.div>
  );
}

// ── Column ───────────────────────────────────────────────────────────

function KanbanColumnView({
  column,
  tasks,
}: {
  column: (typeof COLUMNS)[number];
  tasks: KanbanTask[];
}) {
  const Icon = column.icon;
  const isInProgress = column.id === "in_progress";

  return (
    <div className="flex min-h-0 flex-col">
      {/* Column header */}
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <Icon
          className={cn("h-3.5 w-3.5", isInProgress && "animate-spin")}
          style={{
            color: column.accentVar,
            animationDuration: isInProgress ? "2s" : undefined,
          }}
        />
        <span className="text-xs font-semibold text-foreground">
          {column.label}
        </span>
        {tasks.length > 0 && (
          <GlassBadge color={column.accentVar}>
            {tasks.length}
          </GlassBadge>
        )}
      </div>

      {/* Card list */}
      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {tasks.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-border/40">
            <span className="text-[11px] text-muted-foreground/30">
              No tasks
            </span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────

export function KanbanBoard() {
  const kanbanTasks = useDashboardStore((s) => s.kanbanTasks);
  const kanbanFilter = useDashboardStore((s) => s.kanbanFilter);
  const setKanbanFilter = useDashboardStore((s) => s.setKanbanFilter);

  // Apply agent filter
  const filtered = useMemo(
    () =>
      kanbanFilter === "all"
        ? kanbanTasks
        : kanbanTasks.filter((t) => t.agent === kanbanFilter),
    [kanbanFilter, kanbanTasks]
  );
  const tasksByColumn = useMemo(() => {
    const grouped = Object.fromEntries(
      COLUMNS.map((column) => [column.id, [] as KanbanTask[]])
    ) as Record<KanbanColumn, KanbanTask[]>;

    for (const task of filtered) {
      grouped[task.column].push(task);
    }
    for (const column of COLUMNS) {
      grouped[column.id].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return grouped;
  }, [filtered]);

  return (
    <GlassPanel noPadding className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">Kanban</h3>

        {/* Agent filter tabs */}
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-0/50 p-0.5">
          {FILTER_TABS.map((tab) => {
            const isActive = kanbanFilter === tab.id;
            const agentColor =
              tab.id !== "all" ? AGENTS[tab.id].color : undefined;
            return (
              <button
                key={tab.id}
                onClick={() => setKanbanFilter(tab.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200",
                  isActive
                    ? "bg-surface-2 text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                style={
                  isActive && agentColor
                    ? { color: agentColor }
                    : undefined
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Columns */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-3 p-3">
          {COLUMNS.map((col) => (
            <KanbanColumnView
              key={col.id}
              column={col}
              tasks={tasksByColumn[col.id]}
            />
          ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border/30 px-4 py-1.5">
        <span className="font-mono text-[10px] text-muted-foreground/50">
          {filtered.length} task{filtered.length !== 1 ? "s" : ""}
          {kanbanFilter !== "all" && ` (${kanbanTasks.length} total)`}
        </span>
      </div>
    </GlassPanel>
  );
}
