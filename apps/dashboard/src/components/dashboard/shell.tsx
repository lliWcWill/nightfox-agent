"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useDashboardStore } from "@/hooks/use-store";
import { ConnectionIndicator } from "./connection";
import { AgentStatusPanel } from "./agent-status";
import { ActionLog } from "./action-log";
import { ToolCalls } from "./tool-calls";
import { KanbanBoard } from "./kanban-board";
import { JobRuns } from "./job-runs";
import { QueuePanel } from "./queue-panel";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/constants";
import type { DashboardTask, FleetSummary, KanbanTask, WsMessage } from "@/lib/types";
import {
  Activity,
  Terminal,
  Kanban,
  Radio,
  Settings,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "fleet", icon: Radio, label: "Fleet" },
  { id: "log", icon: Activity, label: "Events" },
  { id: "tools", icon: Terminal, label: "Tool Calls" },
  { id: "tasks", icon: Kanban, label: "Tasks" },
  { id: "settings", icon: Settings, label: "Settings" },
];

function Clock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      className="font-mono text-xs text-muted-foreground/50"
      suppressHydrationWarning
    >
      {time.toLocaleTimeString("en-US", { hour12: false })}
    </span>
  );
}

export function DashboardShell() {
  const processMessage = useDashboardStore((s) => s.processMessage);
  const activePanel = useDashboardStore((s) => s.activePanel);
  const setActivePanel = useDashboardStore((s) => s.setActivePanel);
  const bootstrapFleet = useDashboardStore((s) => s.bootstrapFleet);
  const setKanbanTasks = useDashboardStore((s) => s.setKanbanTasks);

  const handleMessage = useCallback(
    (msg: WsMessage) => processMessage(msg),
    [processMessage]
  );

  const { status } = useWebSocket(handleMessage);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [fleetRes, tasksRes] = await Promise.all([
          fetch(`${API_URL}/api/fleet/summary`),
          fetch(`${API_URL}/api/tasks`),
        ]);
        if (!fleetRes.ok || !tasksRes.ok || cancelled) {
          return;
        }
        const fleet = (await fleetRes.json()) as FleetSummary;
        const tasksPayload = (await tasksRes.json()) as {
          tasks?: DashboardTask[];
        };

        bootstrapFleet(fleet);
        const mappedTasks: KanbanTask[] = (tasksPayload.tasks ?? []).map((task) => ({
          id: task.id,
          title: task.title,
          column:
            task.status === "in_progress" ||
            task.status === "done" ||
            task.status === "archived"
              ? task.status
              : "todo",
          agent:
            task.assignedAgent === "gemini" ||
            task.assignedAgent === "droid" ||
            task.assignedAgent === "groq"
              ? task.assignedAgent
              : "claude",
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          description: task.description || undefined,
          priority: task.priority,
        }));
        setKanbanTasks(mappedTasks);
      } catch {
        // Best effort bootstrap; live events continue over WS.
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [bootstrapFleet, setKanbanTasks]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-0">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <motion.aside
        initial={{ x: -64, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex h-full w-16 shrink-0 flex-col items-center border-r border-border/30 bg-surface-1/50 py-4"
      >
        {/* Logo */}
        <div className="mb-6 flex h-9 w-9 items-center justify-center rounded-xl bg-agent-claude/15">
          <span className="text-lg font-bold text-agent-claude">N</span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activePanel === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                title={item.label}
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200",
                  isActive
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:bg-surface-2/50 hover:text-foreground"
                )}
              >
                <item.icon className="h-4.5 w-4.5" />
                {isActive && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute -left-[8.5px] h-5 w-0.5 rounded-r-full bg-agent-claude"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </motion.aside>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <main className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <motion.header
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="flex shrink-0 items-center justify-between border-b border-border/30 px-6 py-3"
        >
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold tracking-tight text-foreground">
              Nightfox
            </h1>
            <span className="font-mono text-[10px] text-muted-foreground/50">
              ops
            </span>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionIndicator status={status} />
            <Clock />
          </div>
        </motion.header>

        {/* Agent Status Strip */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="shrink-0 px-6 py-3"
        >
          <AgentStatusPanel />
        </motion.div>

        {/* Panel Content */}
        <div className="min-h-0 flex-1 px-6 pb-4">
          {activePanel === "fleet" && (
            <div className="flex h-full flex-col gap-3">
              <div className="grid min-h-0 flex-[2] grid-cols-3 gap-3">
                <div className="col-span-2 min-h-0">
                  <JobRuns />
                </div>
                <QueuePanel />
              </div>
              <div className="min-h-0 flex-1">
                <ActionLog compact />
              </div>
            </div>
          )}

          {/* Full action log view */}
          {activePanel === "log" && (
            <div className="grid h-full grid-cols-3 gap-3">
              <div className="col-span-2">
                <ActionLog />
              </div>
              <ToolCalls />
            </div>
          )}

          {activePanel === "tools" && <ToolCalls />}

          {activePanel === "tasks" && <KanbanBoard />}

          {activePanel === "settings" && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Settings className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground/50">
                  Settings and agent controls are next.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
