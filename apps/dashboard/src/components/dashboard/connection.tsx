"use client";

import { motion } from "motion/react";
import type { ConnectionStatus } from "@/hooks/use-websocket";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { label: string; color: string; pulse: boolean }
> = {
  connected: { label: "Live", color: "var(--status-ready)", pulse: true },
  connecting: {
    label: "Connecting",
    color: "var(--status-thinking)",
    pulse: true,
  },
  disconnected: {
    label: "Offline",
    color: "var(--status-offline)",
    pulse: false,
  },
};

export function ConnectionIndicator({
  status,
}: {
  status: ConnectionStatus;
}) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center justify-center">
        <motion.div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: config.color }}
          animate={
            config.pulse
              ? { scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }
              : undefined
          }
          transition={
            config.pulse
              ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
              : undefined
          }
        />
        {config.pulse && (
          <motion.div
            className="absolute h-2 w-2 rounded-full"
            style={{ backgroundColor: config.color }}
            animate={{ scale: [1, 2.5], opacity: [0.4, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </div>
      <span
        className={cn("font-mono text-xs font-medium")}
        style={{ color: config.color }}
      >
        {config.label}
      </span>
    </div>
  );
}
