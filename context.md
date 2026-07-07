# Code Context

## Files Retrieved

1. `src/extensions/pi-subagents/src/runs/shared/subagent-prompt-runtime.ts` (full) — Child-side runtime: prompt rewriting, boundary instructions, steering inbox watcher, tool budget, structured output, supervisor channel registration
2. `src/extensions/pi-subagents/src/runs/shared/subagent-control.ts` (full) — Control event types, activity state derivation, notification formatting for long-running/idle subagents
3. `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` (lines 1-1092) — Main executor: resolves targets, manages foreground/async/nested resume, spawns children, handles control/steer/interrupt
4. `src/extensions/pi-subagents/src/runs/background/subagent-runner.ts` (lines 1-100) — Background async runner: spawns child Pi processes, watches control inbox, manages worktrees, transcripts
5. `src/extensions/pi-subagents/src/runs/background/control-channel.ts` (full) — File-based control inbox: interrupt/steer/timeout request files, atomic JSON writes, polling/watching
6. `src/extensions/pi-subagents/src/intercom/intercom-bridge.ts` (full) — Intercom bridge: injects `contact_supervisor`/`intercom` tools into child agents, resolves session targets
7. `src/extensions/pi-subagents/src/intercom/native-supervisor-channel.ts` (lines 1-100) — File-based supervisor channel: request/reply dirs under temp root, `contact_supervisor` tool
8. `src/extensions/pi-subagents/src/intercom/result-intercom.ts` (lines 1-100) — Result intercom: delivers subagent results as intercom events to parent
9. `src/extensions/pi-subagents/src/shared/artifacts.ts` (full) — Artifact paths: `{runId}_{agent}_{index}_input.md`, `_output.md`, `.jsonl`, `_transcript.jsonl`, `_meta.json`
10. `src/extensions/pi-subagents/src/shared/utils.ts` (lines 1-80) — Config dir resolution: `DEFAULT_CONFIG_DIR_NAME = ".selesai"`, `getAgentDir()`, `getConfigDirName()`
11. `src/extensions/pi-subagents/src/shared/fork-context.ts` (lines 1-80) — Fork context: branched session files for `context: "fork"` subagents
12. `src/extensions/pi-subagents/src/runs/shared/pi-args.ts` (lines 1-80) — All `SELESAI_SUBAGENT_*` env var names, `buildPiArgs()` for child process args
13. `src/extensions/pi-subagents/src/shared/types.ts` (lines 1-80, grep for constants) — Type definitions, `TEMP_ROOT_DIR`, `RESULTS_DIR`, `ASYNC_DIR`, event names
14. `src/extensions/pi-subagents/src/extension/index.ts` (lines 1-100) — Extension entry point: tool registration, config loading, session root derivation
15. `package.json` (lines 1-30) — `"piConfig": { "configDir": ".selesai" }` — the canonical config dir name
16. `src/extensions/pi-subagents/src/shared/settings.ts` (lines 1-100) — Chain step types, behavior resolution, progress files

## Key Code

### Config dir resolution (Selesai paths, not Pi paths)

```ts
// src/extensions/pi-subagents/src/shared/utils.ts:17
const DEFAULT_CONFIG_DIR_NAME = ".selesai";

// src/extensions/pi-subagents/src/shared/utils.ts:56-63
export function resolveConfigDirName(...): string {
  // 1. Check coding agent module's CONFIG_DIR_NAME export
  // 2. Walk up from entry point looking for @selesai/code package.json piConfig.configDir
  // 3. Fallback: ".selesai"
}

// src/extensions/pi-subagents/src/shared/utils.ts:73-78
export function getAgentDir(): string {
  const configured = process.env.SELESAI_CODING_AGENT_DIR;
  // ~/ -> homedir, ~/.selesai/agent/ -> homedir + .selesai/agent
  return configured || path.join(os.homedir(), getConfigDirName(), "agent");
}
```

### Communication mechanisms

**1. Environment variables** (`pi-args.ts:1-80`):
- `SELESAI_SUBAGENT_CHILD`, `SELESAI_SUBAGENT_RUN_ID`, `SELESAI_SUBAGENT_CHILD_AGENT`, `SELESAI_SUBAGENT_CHILD_INDEX`
- `SELESAI_SUBAGENT_ORCHESTRATOR_TARGET`, `SELESAI_SUBAGENT_ORCHESTRATOR_SESSION_ID`
- `SELESAI_SUBAGENT_STEER_INBOX` — dir path for mid-run steering
- `SELESAI_SUBAGENT_SUPERVISOR_CHANNEL_DIR` — dir path for supervisor request/reply
- `SELESAI_SUBAGENT_PARENT_SESSION` — parent session file path
- `SELESAI_SUBAGENT_INTERCOM_SESSION_NAME` — child's intercom session name
- `SELESAI_SUBAGENT_FANOUT_CHILD` — boolean flag for fanout children
- `STRUCTURED_OUTPUT_CAPTURE_ENV` / `STRUCTURED_OUTPUT_SCHEMA_ENV` — paths for structured output

**2. File-based control channel** (`control-channel.ts`):
- Parent writes `interrupt.json`, `timeout.json`, or `steer-requests/{ts}-{id}.json` into `{asyncDir}/control/`
- Child's prompt runtime watches `steer-targets/{index}/` via `fs.watch` + 250ms polling
- Atomic JSON writes (temp + rename) for crash safety

**3. Supervisor channel** (`native-supervisor-channel.ts`):
- `TEMP_ROOT_DIR/supervisor-channels/{runId}-{agent}-{index}/requests/` and `replies/`
- `contact_supervisor` tool writes request JSON, polls for reply JSON
- Default timeout: 10 minutes

**4. Intercom bridge** (`intercom-bridge.ts`):
- Injects `contact_supervisor` and `intercom` tools into child agent config
- Adds bridge instructions to system prompt (default or from `instructionFile`)
- Resolves session targets: `subagent-chat-{sessionIdPrefix}`

**5. Event bus** (`types.ts:898-903`):
- `subagent:async-started`, `subagent:async-complete`
- `subagent:control-event`, `subagent:control-intercom`
- `subagent:result-intercom`, `subagent:result-intercom-delivery`

### Files/artifacts read and written

| Artifact | Path | Purpose |
|---|---|---|
| Input artifact | `{artifactsDir}/{runId}_{agent}_{index}_input.md` | Task prompt for the subagent |
| Output artifact | `{artifactsDir}/{runId}_{agent}_{index}_output.md` | Final output text |
| JSONL transcript | `{artifactsDir}/{runId}_{agent}_{index}.jsonl` | Full message log |
| Transcript | `{artifactsDir}/{runId}_{agent}_{index}_transcript.jsonl` | Child session transcript |
| Metadata | `{artifactsDir}/{runId}_{agent}_{index}_meta.json` | Run metadata |
| Async status | `{asyncDir}/status.json` | Current async run state |
| Async result | `{asyncDir}/result.json` | Final async run result |
| Control inbox | `{asyncDir}/control/interrupt.json`, `timeout.json`, `steer-requests/` | Parent→child control signals |
| Steer inbox | `{asyncDir}/control/steer-targets/{index}/` | Per-child steering requests |
| Supervisor channel | `TEMP_ROOT_DIR/supervisor-channels/{runId}-{agent}-{index}/` | `contact_supervisor` request/reply |
| Session file | `{sessionDir}/{sessionId}.jsonl` | Full session log |
| Structured output | `{structuredOutputPath}` | Child's final structured JSON |
| Progress file | `{chainDir}/progress.md` | Chain step progress |
| Worktree diffs | `{worktreeDir}/` | Git worktree isolation for parallel tasks |
| Settings (user) | `~/.selesai/agent/settings.json` | User-level agent/settings config |
| Settings (project) | `.selesai/settings.json` | Project-level agent/settings config |
| Extension config | `~/.selesai/agent/extensions/subagent/config.json` | Extension-specific config |
| Project artifacts | `.pi-subagents/artifacts/` | Project-scoped artifact storage |
| Project chain runs | `.pi-subagents/chain-runs/` | Project-scoped chain run storage |

### Config path analysis: Selesai vs Pi

**The runtime uses Selesai config paths (`.selesai/`), not Pi paths (`.pi/`).**

Evidence:
- `DEFAULT_CONFIG_DIR_NAME = ".selesai"` in `shared/utils.ts:17`
- `package.json` declares `"piConfig": { "configDir": ".selesai" }` — this is the canonical source
- `getAgentDir()` defaults to `~/.selesai/agent/` (via `getConfigDirName()` + `"agent"`)
- All env vars use `SELESAI_` prefix (e.g., `SELESAI_SUBAGENT_CHILD`, `SELESAI_CODING_AGENT_DIR`)
- The extension config is documented as `~/.selesai/agent/extensions/subagent/config.json`
- Session files live under `~/.selesai/agent/sessions/`

**One exception**: The project artifact root is `.pi-subagents/` (not `.selesai-subagents/`). This is a hardcoded constant in `artifacts.ts:8`:
```ts
const PROJECT_ARTIFACT_ROOT = ".pi-subagents";
```

**Documentation mismatch**: The SKILL.md and README.md reference `~/.pi/agent/` paths extensively (Pi convention), but the actual runtime code resolves to `.selesai/` paths. The docs are stale/porting artifacts.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Parent Session                     │
│  subagent-executor.ts                                │
│  ┌──────────────────────────────────────────────┐   │
│  │  subagent tool (extension/index.ts)           │   │
│  │  → resolveResumeTarget()                       │   │
│  │  → executeChain() / executeAsyncChain()        │   │
│  │  → spawn child Pi process (foreground/async)   │   │
│  └──────────┬───────────────────────────────────┘   │
│             │ env vars + file paths                  │
│             ▼                                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  Intercom Bridge (intercom-bridge.ts)         │   │
│  │  → injects contact_supervisor/intercom tools  │   │
│  │  → adds bridge instructions to system prompt  │   │
│  └──────────┬───────────────────────────────────┘   │
│             │                                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  Control Channel (control-channel.ts)         │   │
│  │  → file-based interrupt/steer requests        │   │
│  │  → fs.watch + polling for delivery            │   │
│  └──────────┬───────────────────────────────────┘   │
│             │                                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  Supervisor Channel (native-supervisor-      │   │
│  │  channel.ts)                                 │   │
│  │  → file-based request/reply dirs              │   │
│  └──────────┬───────────────────────────────────┘   │
└──────────────┼──────────────────────────────────────┘
               │ spawns
               ▼
┌─────────────────────────────────────────────────────┐
│                   Child Session                      │
│  subagent-prompt-runtime.ts                          │
│  ┌──────────────────────────────────────────────┐   │
│  │  Prompt Rewriting                             │   │
│  │  → stripProjectContext() / stripSkills()      │   │
│  │  → add boundary instructions                  │   │
│  │  → strip parent-only messages                 │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Steering Inbox                               │   │
│  │  → watches SELESAI_SUBAGENT_STEER_INBOX dir   │   │
│  │  → delivers steer messages as user messages   │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Supervisor Client                            │   │
│  │  → contact_supervisor tool                    │   │
│  │  → writes request JSON, polls for reply      │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Structured Output                            │   │
│  │  → structured_output tool                    │   │
│  │  → validates against schema, writes JSON     │   │
│  └──────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Tool Budget                                 │   │
│  │  → soft/hard limits on tool calls            │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Start Here

Open `src/extensions/pi-subagents/src/runs/shared/subagent-prompt-runtime.ts` — it's the child-side entry point that shows how all communication mechanisms (env vars, file-based steering, supervisor channel, structured output, tool budget) are wired together. Then `src/extensions/pi-subagents/src/runs/foreground/subagent-executor.ts` for the parent-side orchestration.

## Key Findings

1. **Communication**: Environment variables (`SELESAI_SUBAGENT_*`) for bootstrap context; file-based control channels (interrupt/steer request files) for mid-run signaling; file-based supervisor channel for `contact_supervisor`; event bus for async completion/control notifications; intercom bridge for bidirectional chat between parent and child.

2. **Artifacts**: Input/output markdown files, JSONL transcripts, metadata JSON, session `.jsonl` files, structured output JSON, progress markdown, worktree diffs — all written to project `.pi-subagents/` or session-adjacent directories.

3. **Config paths**: The runtime uses **Selesai paths** (`.selesai/`) throughout — `DEFAULT_CONFIG_DIR_NAME = ".selesai"`, `getAgentDir()` → `~/.selesai/agent/`, all env vars use `SELESAI_` prefix. The one exception is the project artifact root which is hardcoded as `.pi-subagents/`. Documentation in SKILL.md/README.md references `~/.pi/agent/` paths but these are stale/porting artifacts — the actual code resolves to `.selesai/`.
