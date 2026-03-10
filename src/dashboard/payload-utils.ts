function normalizeObjectRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

export function sanitizeDashboardValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (depth >= 8) {
    return '[Max depth reached]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDashboardValue(item, seen, depth + 1));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(normalizeObjectRecord(value))) {
      output[key] = sanitizeDashboardValue(child, seen, depth + 1);
    }
    seen.delete(value);
    return output;
  }

  return String(value);
}

export function extractToolCallId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = normalizeObjectRecord(value);
  for (const key of ['callId', 'call_id', 'id', 'toolUseId', 'tool_use_id']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return undefined;
}
