/**
 * curl-based fetch implementation for bypassing Cloudflare bot detection.
 *
 * chatgpt.com is behind Cloudflare's managed challenge which blocks
 * Node.js native fetch (TLS fingerprint mismatch). curl has a different
 * TLS fingerprint that passes through without triggering challenges.
 *
 * This implementation spawns curl as a child process and converts
 * the response back into a standard Response object for the OpenAI SDK.
 */

import { spawn } from 'node:child_process';

function headersToEntries(headers?: unknown): Array<[string, string]> {
  if (!headers) return [];

  if (headers instanceof Headers) {
    return Array.from(headers.entries());
  }

  if (Array.isArray(headers)) {
    return headers.map((entry) => {
      const key = entry[0] ?? '';
      const value = entry[1] ?? '';
      return [String(key), String(value)];
    });
  }

  if (typeof headers !== 'object') return [];

  return Object.entries(headers as Record<string, unknown>).map(([key, value]) => {
    if (Array.isArray(value)) {
      return [key, value.join(', ')];
    }
    return [key, String(value)];
  });
}

async function bodyToString(body: unknown): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8');
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return await body.text();
  }
  return undefined;
}

/**
 * Execute an HTTP request via curl, returning a standard Response.
 * Supports streaming responses (used by the Agents SDK for SSE).
 */
export async function curlFetch(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const request = url instanceof Request ? url : undefined;
  const resolvedUrl = typeof url === 'string'
    ? url
    : url instanceof URL
      ? url.toString()
      : request!.url;

  const method = init?.method ?? request?.method ?? 'GET';

  const mergedHeaders = new Headers();
  if (request?.headers) {
    for (const [k, v] of request.headers.entries()) {
      mergedHeaders.set(k, v);
    }
  }
  if (init?.headers) {
    for (const [k, v] of headersToEntries(init.headers)) {
      mergedHeaders.set(k, v);
    }
  }
  const headerEntries = Array.from(mergedHeaders.entries());

  const bodyFromInit = await bodyToString(init?.body);
  const bodyFromRequest = request ? await request.clone().text() : undefined;
  const body = bodyFromInit ?? bodyFromRequest;

  const signal = init?.signal ?? request?.signal;

  // Build curl args
  const args: string[] = [
    '-s',           // silent (no progress)
    '-S',           // show errors
    '-i',           // include response headers
    '-X', method,
    '--max-time', '300',  // 5 minute timeout
  ];

  // Add headers
  if (headerEntries.length > 0) {
    for (const [key, value] of headerEntries) {
      if (key.toLowerCase() !== 'content-length') {
        args.push('-H', `${key}: ${value}`);
      }
    }
  }

  // Add body
  if (body) {
    args.push('-d', body);
  }

  args.push(resolvedUrl);

  return new Promise<Response>((resolve, reject) => {
    const curl = spawn('curl', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Handle abort signal
    if (signal) {
      const onAbort = () => {
        curl.kill('SIGTERM');
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      if (signal.aborted) {
        curl.kill('SIGTERM');
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      curl.on('close', () => signal.removeEventListener('abort', onAbort));
    }

    let headersParsed = false;
    let statusCode = 200;
    let statusText = 'OK';
    const responseHeaders = new Headers();
    let headerBuffer = '';

    // Collect stderr for error reporting
    const stderrChunks: Buffer[] = [];
    curl.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // For streaming: we need to parse headers from the initial output,
    // then pass the body through as a ReadableStream
    const bodyStream = new ReadableStream({
      start(controller) {
        curl.stdout.on('data', (chunk: Buffer) => {
          if (!headersParsed) {
            headerBuffer += chunk.toString('utf8');

            // Headers end at \r\n\r\n
            const headerEnd = headerBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return; // need more data

            const headerSection = headerBuffer.slice(0, headerEnd);
            const bodyRemainder = headerBuffer.slice(headerEnd + 4);

            // Parse status line
            const lines = headerSection.split('\r\n');
            // Find the last status line (curl -i may show intermediate 100 Continue)
            let lastStatusIdx = 0;
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].startsWith('HTTP/')) lastStatusIdx = i;
            }
            const statusLine = lines[lastStatusIdx];
            const statusMatch = statusLine.match(/HTTP\/\S+ (\d+)\s*(.*)/);
            if (statusMatch) {
              statusCode = parseInt(statusMatch[1], 10);
              statusText = statusMatch[2] || '';
            }

            // Parse headers (after last status line)
            for (let i = lastStatusIdx + 1; i < lines.length; i++) {
              const colonIdx = lines[i].indexOf(':');
              if (colonIdx > 0) {
                const key = lines[i].slice(0, colonIdx).trim();
                const value = lines[i].slice(colonIdx + 1).trim();
                responseHeaders.append(key, value);
              }
            }

            headersParsed = true;

            // Push any body data that came with the header chunk
            if (bodyRemainder.length > 0) {
              controller.enqueue(new TextEncoder().encode(bodyRemainder));
            }
          } else {
            controller.enqueue(new Uint8Array(chunk));
          }
        });

        curl.stdout.on('end', () => {
          if (!headersParsed) {
            // Never got headers — likely an error
            controller.error(new Error('curl: no response headers received'));
          } else {
            controller.close();
          }
        });

        curl.on('error', (err) => {
          controller.error(err);
        });
      },

      cancel() {
        curl.kill('SIGTERM');
      },
    });

    // Wait for headers to be parsed before resolving
    const checkHeaders = setInterval(() => {
      if (headersParsed) {
        clearInterval(checkHeaders);
        resolve(new Response(bodyStream, {
          status: statusCode,
          statusText,
          headers: responseHeaders,
        }));
      }
    }, 5);

    curl.on('close', (code) => {
      if (!headersParsed) {
        clearInterval(checkHeaders);
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        reject(new Error(`curl exited with code ${code}: ${stderr}`));
      }
    });

    // Safety timeout for header parsing
    setTimeout(() => {
      if (!headersParsed) {
        clearInterval(checkHeaders);
        curl.kill('SIGTERM');
        reject(new Error('curl: timed out waiting for response headers'));
      }
    }, 30_000);
  });
}
