import { spawnSync } from "node:child_process";

const command = process.argv[2];
const allowedCommands = new Set(["dev", "build", "start", "lint"]);

if (!command || !allowedCommands.has(command)) {
  console.error("Usage: node scripts/run-dashboard-workspace.mjs <dev|build|start|lint>");
  process.exit(1);
}

const npmExecPath = process.env.npm_execpath;
const nodeExecPath = process.env.npm_node_execpath || process.execPath;

const runner = npmExecPath ? nodeExecPath : "npm";
const args = npmExecPath
  ? [npmExecPath, "run", command, "--workspace", "nightfox-dashboard"]
  : ["run", command, "--workspace", "nightfox-dashboard"];

const result = spawnSync(runner, args, {
  stdio: "inherit",
  env: process.env,
  shell: !npmExecPath && process.platform === "win32",
});

process.exit(result.status ?? 1);
