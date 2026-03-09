"use client";

import { motion } from "motion/react";
import { GlassCard } from "@/components/glass/glass-card";
import { useDashboardStore } from "@/hooks/use-store";
import { AGENTS, AGENT_ICONS } from "@/lib/constants";
import { formatTimestamp } from "@/lib/utils";
import type { AgentId, AgentStatus } from "@/lib/types";

const STATUS_STYLES: Record<
  AgentStatus,
  { dotColor: string; pulseClass: string }
> = {
  ready: { dotColor: "var(--status-ready)", pulseClass: "pulse-ready" },
  thinking: {
    dotColor: "var(--status-thinking)",
    pulseClass: "pulse-thinking",
  },
  error: { dotColor: "var(--status-error)", pulseClass: "pulse-error" },
  offline: { dotColor: "var(--status-offline)", pulseClass: "" },
};

export function AgentStatusPanel() {
  const agents = useDashboardStore((s) => s.agents);

  return (
    <div className="grid grid-cols-4 gap-3">
      {(Object.keys(AGENTS) as AgentId[]).map((id, i) => {
        const agent = agents[id];
        const config = AGENTS[id];
        const statusStyle = STATUS_STYLES[agent.status];
        const Icon = AGENT_ICONS[id];

        return (
          <motion.div
            key={id}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <GlassCard
              glow={agent.status !== "offline" ? config.glowClass : undefined}
              className="relative overflow-hidden"
            >
              {/* Accent bar */}
              <div
                className="absolute top-0 left-0 h-0.5 w-full opacity-60"
                style={{ background: config.color }}
              />

              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: `${config.color}18` }}
                  >
                    <Icon
                      className="h-4 w-4"
                      style={{ color: config.color }}
                    />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {config.label}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {agent.model || config.description}
                    </div>
                  </div>
                </div>

                {/* Status dot */}
                <div
                  className={`h-2.5 w-2.5 rounded-full ${statusStyle.pulseClass}`}
                  style={{ backgroundColor: statusStyle.dotColor }}
                />
              </div>

              {/* Activity */}
              {agent.currentActivity && (
                <div className="mt-2.5 truncate font-mono text-[11px] text-muted-foreground">
                  {agent.currentActivity}
                </div>
              )}

              {agent.lastActivity && (
                <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  {formatTimestamp(agent.lastActivity)}
                </div>
              )}
            </GlassCard>
          </motion.div>
        );
      })}
    </div>
  );
}
