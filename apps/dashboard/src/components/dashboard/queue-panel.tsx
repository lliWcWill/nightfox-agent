"use client";

import { GlassPanel } from "@/components/glass/glass-panel";
import { useDashboardStore } from "@/hooks/use-store";
import { cn, formatTimestamp, truncate } from "@/lib/utils";

export function QueuePanel() {
  const queues = useDashboardStore((s) => s.queues);

  return (
    <GlassPanel className="flex h-full flex-col">
      <div className="border-b border-border/30 pb-3">
        <h3 className="text-sm font-semibold text-foreground">Queue Pressure</h3>
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          Per-chat request backlog and processing state.
        </p>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {queues.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/40 text-[11px] text-muted-foreground/40">
            No active queues
          </div>
        ) : (
          queues.map((queue) => (
            <div key={queue.chatId} className="glass rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono text-xs font-semibold text-foreground">
                    chat {queue.chatId}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground/60">
                    {queue.isProcessing ? "processing" : "idle"} · depth {queue.depth}
                  </div>
                </div>
                <div
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    queue.isProcessing ? "bg-status-thinking" : "bg-status-ready"
                  )}
                />
              </div>
              {queue.lastMessage && (
                <div className="mt-3 font-mono text-[10px] text-muted-foreground">
                  {truncate(queue.lastMessage, 96)}
                </div>
              )}
              <div className="mt-2 font-mono text-[10px] text-muted-foreground/45">
                {formatTimestamp(queue.updatedAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </GlassPanel>
  );
}
