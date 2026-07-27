## Review
- No blockers or actionable findings. `src/extensions/context-compaction-reminder.ts` uses supported `agent_settled` and successful `session_compact` events, reads the authoritative `ExtensionContext.getContextUsage()` API, preserves its latch for unknown post-compaction usage, and resets only after compaction or known low usage. The test covers the threshold boundary, deduplication, unknown/null usage, and both reset paths. `src/extensions/package.json` includes the new bundled entry.

## Validation
- `npx vitest run src/extensions/context-compaction-reminder.test.ts` — passed: 4 tests, 0 failures.
- `git diff --check -- src/extensions/package.json` — passed; manifest diff is one entry with no whitespace errors.