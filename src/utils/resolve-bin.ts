import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const cache = new Map<string, string>();
const isWin = process.platform === 'win32';

/**
 * Provide a platform-specific ordered list of directories to search for binaries.
 *
 * The returned list is tailored to the current platform (Windows, macOS, or other Unix-like systems)
 * and includes common install locations such as Scoop/WinGet/Chocolatey paths on Windows,
 * Homebrew and system bins on macOS, and user/local bin paths on Linux-like systems.
 *
 * @returns An ordered array of absolute directory paths appropriate for the current platform.
 */
function getSearchDirs(): string[] {
  const home = os.homedir();

  switch (process.platform) {
    case 'win32':
      return [
        path.join(home, 'scoop', 'shims'),
        path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'yt-dlp'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin'),
        path.join(process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey', 'bin'),
      ];
    case 'darwin':
      return [
        '/opt/homebrew/bin',        // Apple Silicon Homebrew
        '/usr/local/bin',           // Intel Homebrew
        '/usr/bin',
        path.join(home, '.local', 'bin'),
      ];
    default: // linux, freebsd, etc.
      return [
        path.join(home, '.local', 'bin'),
        '/usr/local/bin',
        '/usr/bin',
        '/snap/bin',
      ];
  }
}

const SEARCH_DIRS = getSearchDirs();

/**
 * Resolve a program name to an executable path available on the system.
 *
 * Attempts to locate the named binary using the system lookup (e.g., `which`/`where`), then by checking platform-specific installation directories, and caches the first successful result. If no path is found, returns the original `name` so the caller can rely on PATH resolution.
 *
 * @param name - The binary name to resolve; must not contain path separators, `..`, or null bytes.
 * @returns The filesystem path to the resolved executable, or the original `name` if no explicit path was found.
 * @throws Error if `name` contains '/', '\\', '..', or a null character.
 */
export function resolveBin(name: string): string {
  // Reject names with path separators to prevent traversal
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new Error(`Invalid binary name: ${name}`);
  }

  const cached = cache.get(name);
  if (cached) return cached;

  // Try the platform's lookup command first (works when PATH is correct)
  try {
    const cmd = isWin ? 'where' : 'which';
    const result = execFileSync(cmd, [name], { encoding: 'utf8', timeout: 3000 }).trim();
    // `where` on Windows can return multiple lines — take the first
    const resolved = result.split(/\r?\n/)[0];
    if (resolved) {
      cache.set(name, resolved);
      return resolved;
    }
  } catch { /* lookup failed or not found */ }

  // Check platform-specific directories
  const suffixes = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of SEARCH_DIRS) {
    for (const ext of suffixes) {
      const fullPath = path.join(dir, name + ext);
      try {
        fs.accessSync(fullPath, isWin ? fs.constants.F_OK : fs.constants.X_OK);
        cache.set(name, fullPath);
        return fullPath;
      } catch { /* not found or not executable */ }
    }
  }

  // Fall back to bare name (let execFile try PATH as last resort)
  return name;
}