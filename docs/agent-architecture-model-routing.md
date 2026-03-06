# Agent Architecture: Model Routing (Sprint/Phase Ops)

## Primary routing
- **Main driver (planning + complex tool orchestration):** `gpt-5.4`
- **Workforce sprint loops (fast execution):** `gpt-5.3-codex-spark`

## Why
- `gpt-5.4` is set as default and primary quality model for high-stakes planning/review.
- Spark remains the high-throughput worker model for background sprint tasks.

## Policy
- Default model: `OPENAI_DEFAULT_MODEL=gpt-5.4`
- Aliases:
  - `codex`, `codex-high`, `high` -> `gpt-5.4`
  - `spark`, `codex-spark` -> `gpt-5.3-codex-spark`

## Notes
- `gpt-5.4-codex*` variants were not available in current ChatGPT-account Codex path tests.
- Keep fallback logic enabled for unsupported model paths.
