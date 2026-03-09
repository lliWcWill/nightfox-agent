"use client";

import { cn } from "@/lib/utils";

interface GlassBadgeProps {
  children: React.ReactNode;
  color?: string;
  className?: string;
}

export function GlassBadge({ children, color, className }: GlassBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5",
        "text-xs font-mono font-medium",
        "glass-subtle",
        className
      )}
      style={color ? { color, borderColor: `${color}33` } : undefined}
    >
      {children}
    </span>
  );
}
