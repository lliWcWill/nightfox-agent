import * as fs from 'fs';
import { ProxyAgent } from 'undici';
import { config } from '../config.js';

let proxyList: string[] = [];
let proxyIndex = 0;

/**
 * Lazily loads proxy URLs from the configured proxy list file into the in-memory cache.
 *
 * If the list is already loaded or the configuration key `config.YTDLP_PROXY_LIST_PATH` is unset, this function is a no-op.
 * When a file is present it reads UTF-8 lines, trims them, and retains only non-empty lines that do not start with `#`.
 * On success it updates the module cache (`proxyList`) and logs the number of loaded proxies; on failure it logs a warning.
 */
function ensureLoaded(): void {
  if (proxyList.length > 0) return;

  const listPath = config.YTDLP_PROXY_LIST_PATH;
  if (!listPath) return;

  try {
    if (fs.existsSync(listPath)) {
      proxyList = fs.readFileSync(listPath, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
      console.log(`[proxy] Loaded ${proxyList.length} residential proxies`);
    }
  } catch (err) {
    console.warn('[proxy] Failed to load proxy list:', err);
  }
}

/**
 * Selects and returns the next proxy URL from the configured list using round‑robin order.
 *
 * Advances the internal index so subsequent calls return the next proxy.
 *
 * @returns The next proxy URL, or `null` if no proxies are configured or available.
 */
export function getNextProxy(): string | null {
  ensureLoaded();
  if (proxyList.length === 0) return null;
  const proxy = proxyList[proxyIndex % proxyList.length];
  proxyIndex++;
  return proxy;
}

/**
 * Create an undici ProxyAgent dispatcher for use with fetch().
 * Returns null if no proxies are available.
 */
const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks5:']);

/**
 * Create an undici ProxyAgent for the next configured proxy if one is available and valid.
 *
 * @returns `ProxyAgent` configured with the next proxy URL, or `null` if no proxy is available, the URL is malformed, or the proxy protocol is not allowed (`http:`, `https:`, `socks4:`, `socks5:`)
 */
export function getProxyDispatcher(): ProxyAgent | null {
  const proxyUrl = getNextProxy();
  if (!proxyUrl) return null;

  try {
    const parsed = new URL(proxyUrl);
    if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
      console.warn(`[proxy] Rejected invalid proxy protocol: ${parsed.protocol}`);
      return null;
    }
  } catch {
    console.warn('[proxy] Rejected malformed proxy URL');
    return null;
  }

  return new ProxyAgent(proxyUrl);
}