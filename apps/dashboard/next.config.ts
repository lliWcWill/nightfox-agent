import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const turbopackRoot = path.resolve(rootDir, "../../../../");

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    // Worktree builds resolve hoisted Next dependencies from the main repo root.
    root: turbopackRoot,
  },
};

export default nextConfig;
