"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GlassPanel } from "@/components/glass/glass-panel";
import { GlassBadge } from "@/components/glass/glass-badge";
import { useDashboardStore } from "@/hooks/use-store";
import { EVENT_COLORS } from "@/lib/constants";
import {
  formatTimestamp,
  cn,
  eventDescription,
  copyToClipboard,
  formatEventForCopy,
  formatAllEventsForCopy,
} from "@/lib/utils";
import {
  ArrowDownToLine,
  Search,
  ChevronDown,
  ChevronRight,
  Trash2,
  Copy,
  CheckCircle2,
  ClipboardList,
  Mic,
  Brain,
} from "lucide-react";
import type { DashboardEvent } from "@/lib/types";

// ── Copy Button with feedback ────────────────────────────────────────

function CopyButton({
  getText,
  className,
  size = "sm",
}: {
  getText: () => string;
  className?: string;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(getText());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const iconSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "flex items-center justify-center rounded-md transition-all",
        copied
          ? "text-status-ready"
          : "text-muted-foreground/40 hover:text-foreground",
        className
      )}
      title="Copy to clipboard"
    >
      {copied ? (
        <CheckCircle2 className={iconSize} />
      ) : (
        <Copy className={iconSize} />
      )}
    </button>
  );
}

// ── Conversation Bubble (voice:text / groq:complete) ─────────────────

function ConversationBubble({
  event,
  onMeasure,
}: {
  event: DashboardEvent;
  onMeasure?: () => void;
}) {
  const isUser = event.type === "groq:complete";
  const text = String(event.payload.text || "");
  const Icon = isUser ? Mic : Brain;
  const label = isUser ? "You" : "Gemini";
  const accentColor = isUser ? "var(--agent-groq)" : "var(--agent-gemini)";

  useEffect(() => {
    onMeasure?.();
  }, [onMeasure]);

  return (
    <div
      className={cn(
        "group flex gap-2 px-3 py-2",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: `color-mix(in srgb, ${accentColor} 20%, transparent)` }}
      >
        <Icon className="h-3 w-3" style={{ color: accentColor }} />
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "relative max-w-[80%] rounded-xl px-3 py-2",
          isUser
            ? "rounded-tr-sm bg-surface-3/80"
            : "rounded-tl-sm bg-surface-2/80"
        )}
      >
        <div className="mb-0.5 flex items-center gap-1.5">
          <span
            className="text-[10px] font-semibold"
            style={{ color: accentColor }}
          >
            {label}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground/40">
            {formatTimestamp(event.timestamp)}
          </span>
        </div>
        <div className="text-xs leading-relaxed text-foreground/90">
          {text}
        </div>

        {/* Copy on hover */}
        <CopyButton
          getText={() => `[${label}] ${text}`}
          size="xs"
          className="absolute -top-1 -right-1 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    </div>
  );
}

// ── Event Row ────────────────────────────────────────────────────────

function EventRow({
  event,
  onToggle,
}: {
  event: DashboardEvent;
  onToggle?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = EVENT_COLORS[event.type] || "var(--muted)";
  const typeLabel = event.type.split(":")[1] || event.type;

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  return (
    <div className="group border-b border-border/30 px-3 py-2">
      <div
        className="flex cursor-pointer items-center gap-3"
        onClick={handleToggle}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}

        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
          {formatTimestamp(event.timestamp)}
        </span>

        <GlassBadge color={color}>{typeLabel}</GlassBadge>

        <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
          {eventDescription(event)}
        </span>

        {/* Per-event copy */}
        <CopyButton
          getText={() => formatEventForCopy(event)}
          size="xs"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
            onAnimationComplete={() => onToggle?.()}
          >
            <pre className="mt-2 ml-6 max-h-48 overflow-auto rounded-lg bg-surface-0/50 p-3 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Row Renderer (picks bubble vs flat row) ──────────────────────────

function EventRenderer({
  event,
  onToggle,
}: {
  event: DashboardEvent;
  onToggle?: () => void;
}) {
  // Conversation bubbles for text events
  if (event.type === "voice:text" || event.type === "groq:complete") {
    return <ConversationBubble event={event} onMeasure={onToggle} />;
  }
  return <EventRow event={event} onToggle={onToggle} />;
}

// ── Action Log ───────────────────────────────────────────────────────

export function ActionLog({ compact = false }: { compact?: boolean }) {
  "use no memo";

  const events = useDashboardStore((s) => s.events);
  const eventFilter = useDashboardStore((s) => s.eventFilter);
  const setEventFilter = useDashboardStore((s) => s.setEventFilter);
  const autoScroll = useDashboardStore((s) => s.autoScroll);
  const toggleAutoScroll = useDashboardStore((s) => s.toggleAutoScroll);
  const clearEvents = useDashboardStore((s) => s.clearEvents);
  const [copyAllDone, setCopyAllDone] = useState(false);

  const parentRef = useRef<HTMLDivElement>(null);

  const normalizedFilter = eventFilter.trim().toLowerCase();
  const searchableEvents = useMemo(
    () =>
      events.map((event) => ({
        event,
        searchText: `${event.type} ${eventDescription(event)} ${JSON.stringify(event.payload)}`.toLowerCase(),
      })),
    [events]
  );
  const filtered = normalizedFilter
    ? searchableEvents
        .filter(({ searchText }) => searchText.includes(normalizedFilter))
        .map(({ event }) => event)
    : events;

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 15,
  });

  // Re-measure when rows expand/collapse
  const handleRowToggle = useCallback(() => {
    virtualizer.measure();
  }, [virtualizer]);

  // Auto-scroll to bottom (defer to next frame so virtualizer finishes measuring)
  useEffect(() => {
    if (autoScroll && filtered.length > 0) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
      });
    }
  }, [filtered.length, autoScroll, virtualizer]);

  const handleCopyAll = async () => {
    const ok = await copyToClipboard(formatAllEventsForCopy(filtered));
    if (ok) {
      setCopyAllDone(true);
      setTimeout(() => setCopyAllDone(false), 1500);
    }
  };

  return (
    <GlassPanel noPadding className="flex h-full flex-col">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border/30 px-4",
          compact ? "py-1.5" : "py-2.5"
        )}
      >
        <h3 className="text-sm font-semibold text-foreground">Action Log</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter events..."
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className={cn(
                "h-7 rounded-md bg-surface-0/50 pl-8 pr-3 font-mono text-[11px] text-foreground outline-none ring-1 ring-border/50 placeholder:text-muted-foreground/40 focus:ring-border-hover",
                compact ? "w-32" : "w-44"
              )}
            />
          </div>
          {/* Copy all */}
          <button
            onClick={handleCopyAll}
            title="Copy all events"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors",
              copyAllDone
                ? "text-status-ready"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {copyAllDone ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <ClipboardList className="h-3 w-3" />
            )}
            {!compact && (copyAllDone ? "Copied" : "Copy")}
          </button>
          <button
            onClick={toggleAutoScroll}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors",
              autoScroll
                ? "bg-agent-claude/15 text-agent-claude"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ArrowDownToLine className="h-3 w-3" />
            {!compact && "Auto"}
          </button>
          <button
            onClick={clearEvents}
            title="Clear all events"
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-status-error"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Virtualized list */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground/50">
            Waiting for events...
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
              >
                <EventRenderer
                  event={filtered[virtualItem.index]}
                  onToggle={handleRowToggle}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer (hidden in compact mode) */}
      {!compact && (
        <div className="border-t border-border/30 px-4 py-1.5">
          <span className="font-mono text-[10px] text-muted-foreground/50">
            {filtered.length} events
            {eventFilter && ` (${events.length} total)`}
          </span>
        </div>
      )}
    </GlassPanel>
  );
}
