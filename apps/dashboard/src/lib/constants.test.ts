import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import path from "node:path";
import test from "node:test";

const constantsUrl = pathToFileURL(
  path.join(dirname(fileURLToPath(import.meta.url)), "constants.ts")
).href;

type DashboardEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_API_URL?: string;
  NEXT_PUBLIC_WS_URL?: string;
};

function loadConstants(env: DashboardEnv) {
  const childEnv = { ...process.env };

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) {
      delete childEnv[name];
    } else {
      childEnv[name] = value;
    }
  }

  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `const constants = await import(${JSON.stringify(constantsUrl)});
const exported = constants.default ?? constants;
console.log(JSON.stringify({ API_URL: exported.API_URL, WS_URL: exported.WS_URL }));`,
    ],
    {
      encoding: "utf8",
      env: childEnv,
    }
  );

  return JSON.parse(output) as { API_URL: string; WS_URL: string };
}

test("dashboard constants fall back to localhost:3011 during development", () => {
  const { API_URL, WS_URL } = loadConstants({ NODE_ENV: "development" });

  assert.equal(API_URL, "http://localhost:3011");
  assert.equal(WS_URL, "ws://localhost:3011/ws");
});

test("dashboard constants default to same-origin backend paths in production", () => {
  const { API_URL, WS_URL } = loadConstants({ NODE_ENV: "production" });

  assert.equal(API_URL, "");
  assert.equal(WS_URL, "/ws");
});

test("dashboard constants prefer explicit public endpoint overrides", () => {
  const { API_URL, WS_URL } = loadConstants({
    NODE_ENV: "production",
    NEXT_PUBLIC_API_URL: "https://nightfox.example",
    NEXT_PUBLIC_WS_URL: "wss://nightfox.example/ws",
  });

  assert.equal(API_URL, "https://nightfox.example");
  assert.equal(WS_URL, "wss://nightfox.example/ws");
});
