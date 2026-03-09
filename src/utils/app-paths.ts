import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'Nightfox';
export const APP_SLUG = 'nightfox';
export const APP_STATE_DIR = `.${APP_SLUG}`;
export const APP_ENV_PATH_VAR = 'NIGHTFOX_ENV_PATH';
export const DISCORD_SERVICE_NAME = 'nightfox-discord.service';
export const TELEGRAM_SERVICE_NAME = 'nightfox-telegram.service';
export const BOTCTL_SCRIPT_NAME = 'nightfox-botctl.sh';
export const OPENAI_AGENT_NAME = 'nightfox-openai';

export const LEGACY_APP_NAME = 'Claudegram';
export const LEGACY_APP_SLUG = 'claudegram';
export const LEGACY_APP_STATE_DIR = `.${LEGACY_APP_SLUG}`;
export const LEGACY_APP_ENV_PATH_VAR = 'CLAUDEGRAM_ENV_PATH';
export const LEGACY_DISCORD_SERVICE_NAME = 'claudegram-discord.service';
export const LEGACY_TELEGRAM_SERVICE_NAME = 'claudegram.service';
export const LEGACY_BOTCTL_SCRIPT_NAME = 'claudegram-botctl.sh';

function joinPosix(base: string, ...segments: string[]) {
  return path.posix.join(base, ...segments);
}

export function resolveEnvPath(defaultEnvPath: string) {
  return process.env[APP_ENV_PATH_VAR] || process.env[LEGACY_APP_ENV_PATH_VAR] || defaultEnvPath;
}

export function getHomeStateDir() {
  return path.join(os.homedir(), APP_STATE_DIR);
}

export function getLegacyHomeStateDir() {
  return path.join(os.homedir(), LEGACY_APP_STATE_DIR);
}

export function getHomeStatePath(...segments: string[]) {
  return path.join(getHomeStateDir(), ...segments);
}

export function resolveExistingHomeStatePath(...segments: string[]) {
  const preferredPath = getHomeStatePath(...segments);
  if (fs.existsSync(preferredPath)) return preferredPath;
  const legacyPath = path.join(getLegacyHomeStateDir(), ...segments);
  return fs.existsSync(legacyPath) ? legacyPath : preferredPath;
}

export function ensureHomeStateDir(...segments: string[]) {
  const dir = path.join(getHomeStateDir(), ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getHomeStateLabel(...segments: string[]) {
  return joinPosix(`~/${APP_STATE_DIR}`, ...segments);
}

export function getLegacyHomeStateLabel(...segments: string[]) {
  return joinPosix(`~/${LEGACY_APP_STATE_DIR}`, ...segments);
}

export function getProjectStateDir(root = process.cwd()) {
  return path.join(root, APP_STATE_DIR);
}

export function getProjectStatePath(root = process.cwd(), ...segments: string[]) {
  return path.join(getProjectStateDir(root), ...segments);
}

export function ensureProjectStateDir(root = process.cwd(), ...segments: string[]) {
  const dir = path.join(getProjectStateDir(root), ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getProjectStateLabel(...segments: string[]) {
  return joinPosix(APP_STATE_DIR, ...segments);
}
