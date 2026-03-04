## Stage 1.5 — Background Job Completion Notifications

This stage adds deferred completion notifications so background jobs can finish while normal chat continues.

### Goals
- Notification outbox queue for terminal job states
- Conversation activity gate (active/idle)
- Deferred dispatch when conversation is idle
- Digest mode when multiple jobs complete
- Immediate alert path for critical failures (`failed`, `timeout`)

### Design
- **Outbox key scope**: `guildId:channelId:threadId:userId`
- **Activity gate** tracks last activity in each scope
- **Deferred dispatcher** checks pending outbox every 5s:
  - if scope active: defer non-critical notifications
  - if idle: send digest/summary
  - if critical: send immediately

### Current implementation
- Added `activity-gate.ts`
- Added `job-notification-outbox.ts`
- Extended `job-notifier.ts` with deferred dispatch + digest + critical path
- Hooked activity marks in:
  - Discord message handler
  - Discord interaction handler

### Notes / limitations
- Outbox is in-memory (not persisted yet)
- Dispatch uses channel/thread send path only
- Future: persist outbox and add user mention policy for critical alerts
