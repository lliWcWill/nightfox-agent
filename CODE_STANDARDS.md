# Code Standards — Nightfox

> Every sprint agent MUST read this before writing any code.

---

## Language & Runtime

- **TypeScript** with `strict: true` (tsconfig enforced)
- **Target**: ES2022, **Module**: ESNext, **Resolution**: bundler
- **Runtime**: Node.js 24+
- **Package type**: ESM (`"type": "module"` in package.json)

---

## TypeScript Rules

### Strict Mode — No Exceptions
- `strict: true` is enabled. Do not weaken it.
- **Never use `any`**. Use `unknown` and narrow with type guards.
- **Never use `@ts-ignore`**. Fix the type error.
- **Never use `as` type assertions** unless you can prove correctness.
- **No non-null assertions (`!`)** unless the value was just checked.

### Type Organization
- Export types from the file that owns them.
- Use `interface` for object shapes, `type` for unions/intersections/aliases.
- Shared types go in a `types.ts` file within the module folder.

### Generics
- Name generics meaningfully: `TEvent`, `TResult` — not `T`, `U`.
- Constrain generics: `<T extends Record<string, unknown>>` not `<T>`.

---

## Import Conventions

### Ordering (enforced)
1. Node.js builtins (`node:fs`, `node:path`, `node:crypto`)
2. External packages (`better-sqlite3`, `grammy`, `zod`)
3. Internal absolute (`../config.js`, `../utils/sanitize.js`)
4. Relative siblings (`./types.js`, `./helpers.js`)

Blank line between each group.

### Rules
- **Always use `.js` extension** in import paths (ESM requirement).
- **Use `import type { Foo }` for type-only imports**.
- **No path aliases** — use relative paths.
- **No default exports** — use named exports.
- **No barrel files** (`index.ts` re-exporting everything).

---

## Error Handling

### Catch Blocks
```typescript
// CORRECT
catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
}

// WRONG — never do this
catch (error: any) { ... }
catch (error) { ... }  // implicit any
```

### Error Reporting
- Use `sanitizeError()` for any error shown to users (strips stack traces, internal paths).
- Log full errors internally with `console.error('[Module]', error)`.
- Always prefix log messages with module name: `[EventStore]`, `[ToolGateway]`, etc.

### Async Error Handling
- Always handle promise rejections. No fire-and-forget promises.
- Use `process.on('unhandledRejection', ...)` at entry points.
- Wrap `setTimeout`/`setInterval` callbacks in try-catch.

---

## Config & Secrets

- **All config access goes through `src/config.ts`** (Zod-validated).
- **Never read `process.env` directly** in application code.
- **Never hardcode secrets, tokens, or API keys**.
- **Never log secrets** — not even partially.

---

## Database Patterns

### SQLite (better-sqlite3)
- **WAL mode** for all new tables: `PRAGMA journal_mode=WAL`.
- **Use prepared statements** — never string-interpolate SQL.
- **Schema migrations**: version-tracked, forward-only.
- **Transactions** for multi-statement writes: `db.transaction(() => { ... })()`.
- **Column naming**: `snake_case` for all columns.
- **Timestamps**: ISO 8601 strings (`new Date().toISOString()`).

### Query Patterns
```typescript
// CORRECT — prepared statement
const stmt = db.prepare('SELECT * FROM events WHERE trace_id = ?');
const rows = stmt.all(traceId);

// WRONG — string interpolation (SQL injection risk)
db.exec(`SELECT * FROM events WHERE trace_id = '${traceId}'`);
```

---

## Event Bus Usage

- Use the existing `DashboardEventBus` for all event emission.
- Event names are `kebab-case`: `tool-call:start`, `agent:response`.
- Always include `timestamp` and `sessionId` in event payloads.
- Never emit events from constructors.

---

## Async Patterns

- Use `AsyncLocalStorage` for request-scoped context (trace IDs).
- Never block the event loop with synchronous I/O in async paths.
- Use `Promise.allSettled()` over `Promise.all()` when partial failure is acceptable.

---

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | `kebab-case.ts` | `event-store.ts` |
| Variables | `camelCase` | `traceId` |
| Functions | `camelCase` | `computeHash()` |
| Classes | `PascalCase` | `EventStore` |
| Types/Interfaces | `PascalCase` | `TraceContext` |
| Constants | `SCREAMING_SNAKE` | `MAX_RETRIES` |
| DB columns | `snake_case` | `trace_id` |
| Event names | `kebab-case` | `tool-call:start` |
| Env vars | `SCREAMING_SNAKE` | `CLAUDE_API_KEY` |

---

## Security Standards

### Input Validation
- Validate ALL external input with Zod schemas.
- Never trust user input, webhook payloads, or API responses.

### Path Traversal Prevention
- Use `path.resolve()` and verify the result starts with the expected base directory.
- Never pass user input directly to `fs` operations.

### Forbidden Patterns
- **No `eval()`** — ever.
- **No `new Function()`** — ever.
- **No `child_process.exec()` with user input** — use `execFile()` with argument arrays.
- **No `innerHTML` or `dangerouslySetInnerHTML`** with user content.

### Dependency Security
- Pin exact versions in `package.json` for critical deps.
- Run `npm audit` before merging.

---

## File Size Limits

- **Target**: 500 lines per file.
- **Hard max**: 800 lines. If a file exceeds this, refactor.
- **Functions**: Max 50 lines. Extract helpers.
- **Known exception**: `src/claude/command.handler.ts` (2,887 lines) — legacy, do not add to it.

---

## What NOT To Do

- Don't add comments explaining obvious code.
- Don't add JSDoc to every function — only public APIs and non-obvious behavior.
- Don't create abstractions for one-time operations.
- Don't add error handling for impossible states.
- Don't refactor code you didn't change.
- Don't add features beyond what was requested.
- Don't use `console.log` for debugging — use proper `[Module]` prefixed logging.

---

## Pre-Commit Checklist

Before committing any code, verify:

- [ ] `npm run typecheck` passes (zero errors)
- [ ] No `any` types introduced
- [ ] No `process.env` access outside `config.ts`
- [ ] No string-interpolated SQL
- [ ] No hardcoded secrets
- [ ] All new imports use `.js` extension
- [ ] All catch blocks use `unknown`
- [ ] File stays under 800 lines
- [ ] Event emissions include timestamp + sessionId
