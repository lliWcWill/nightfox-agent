"use client";

import dynamic from "next/dynamic";

const DashboardShell = dynamic(
  () =>
    import("@/components/dashboard/shell").then((mod) => mod.DashboardShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center bg-surface-0 text-sm text-muted-foreground">
        Loading Nightfox Ops...
      </div>
    ),
  }
);

export default function Home() {
  return <DashboardShell />;
}
