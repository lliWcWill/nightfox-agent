"use client";

import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: string;
}

export function GlassCard({
  className,
  glow,
  children,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        "glass rounded-xl p-4 transition-all duration-300",
        "hover:border-border-hover",
        glow,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
