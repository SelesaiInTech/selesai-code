# Pi RPC research — desktop GUI integration

**Goal:** cross-platform desktop GUI for Selesai/Pi. Scope: RPC only.  
**Verified:** 2026-07-23 against local [`docs/rpc.md`](../rpc.md) and Selesai `0.5.14` source. The supplied [Pi RPC docs](https://pi.dev/docs/latest/rpc) did not return usable evidence during research; verify it before shipping against another Pi version. Local source is implementation truth for this fork.

## Verdict

Use one long-lived local agent subprocess per workspace/session:

```text
Electron renderer / Tauri webview
  -> narrow app IPC (main process / Rust backend owns lifecycle)
  -> stdin JSONL / stdout JSONL
  -> `selesai --mode rpc` child, spawned with cwd = selected workspace
```

RPC is process-local stdio, not HTTP/WebSocket. It is language-neutral, so Electron and Rust are equally viable. Keep protocol ownership out of renderer/webview; it prevents arbitrary child-process launch, environment access, or shell input from untrusted UI content.

Do not build a network RPC server first. No network transport, authentication, version handshake, or reconnect/resume protocol exists in Pi RPC.

## Wire contract

- Start: `selesai --mode rpc [normal CLI options]`; set process `cwd` to workspace. `--provider`, `--model`, session options, tool flags, and extension flags remain CLI startup concerns. [Docs](../rpc.md#starting-rpc-mode), [`src/cli/args.ts`](../../src/cli/args.ts), [`src/main.ts`](../../src/main.ts).
- Send UTF-8 JSON objects to stdin, exactly one record per LF (`\n`). Receive mixed responses/events on stdout, same framing. Accept CRLF input by removing only trailing `\r`.
- Split **only** on LF. Do not use Node `readline`; it also splits U+2028/U+2029, valid JSON string characters. Use incremental UTF-8 decoding then LF scan; Rust implementation should use `read_until(b'\n')`, not Unicode line splitting. [`src/modes/rpc/jsonl.ts`](../../src/modes/rpc/jsonl.ts).
- stdout is protocol-only: Pi redirects ordinary `stdout` writes to stderr in non-interactive modes. Capture/display stderr as diagnostics, never parse it as protocol. [`src/core/output-guard.ts`](../../src/core/output-guard.ts).
- Commands may include client-generated string `id`; only their `response` echoes it. Events have no request id and can interleave responses. Maintain `Map<id, pending request>` plus independent event reducer. [`src/modes/rpc/rpc-types.ts`](../../src/modes/rpc/rpc-types.ts).
- No `ready` event. After spawn, issue `get_state` with an id and treat response as ready; enforce startup timeout and surface process stderr/exit. Do not rely on the bundled Node client's 100 ms delay. [`src/modes/rpc/rpc-client.ts`](../../src/modes/rpc/rpc-client.ts).
- Closing stdin stops RPC process. `SIGTERM` terminates it; on Windows process-tree termination needs host-specific handling. [`src/modes/rpc/rpc-mode.ts`](../../src/modes/rpc/rpc-mode.ts).

## GUI-critical commands

| Need | RPC |
| --- | --- |
| submit | `prompt {message, images?}` |
| alter active run | `steer`, or `prompt` with `streamingBehavior: "steer"` |
| enqueue after run | `follow_up`, or `prompt` with `streamingBehavior: "followUp"` |
| stop | `abort` |
| initial/resync state | `get_state`, `get_messages`, `get_entries {since?}`, `get_tree` |
| session controls | `new_session`, `switch_session`, `fork`, `clone`, `set_session_name` |
| settings UI | `get_available_models`, `set_model`, thinking and queue-mode commands |
| status/cost UI | `get_session_stats`; compaction/retry controls |
| extensions/skills palette | `get_commands`, then submit `/name` via `prompt` |

Full request/response unions: [`src/modes/rpc/rpc-types.ts`](../../src/modes/rpc/rpc-types.ts). `prompt` success means accepted/queued/handled, **not** successful model completion. Later failure appears in streamed message/event state; never wait for a second response with same id. [Docs](../rpc.md#prompting).

Avoid exposing RPC `bash` as a generic GUI convenience: it executes a local shell command immediately and injects result into the next model prompt unless `excludeFromContext` is used. It is not needed for normal agent tool display. [Docs](../rpc.md#bash), [`src/modes/rpc/rpc-types.ts`](../../src/modes/rpc/rpc-types.ts).

## Event reducer

Model UI from events, not polling:

- `agent_start` / `agent_end`: run boundaries. Local `agent_end` has `willRetry`; retain UI when true.
- `message_start`, `message_update`, `message_end`: render text, thinking, and tool-call blocks. Append `text_delta` in order; retain final message from `message_end` as canonical.
- `tool_execution_start|update|end`: key by `toolCallId`; `partialResult` is accumulated output, so replace tool-output view rather than append it.
- `queue_update`: render queued steer/follow-up instructions.
- `compaction_*`, `auto_retry_*`: show durable status; do not report terminal failure before retry ends.
- `agent_settled`: strongest local idle signal; use it to enable “completed” UX. It fires after agent loop exits and pending queues are drained. [`src/core/agent-session.ts`](../../src/core/agent-session.ts), [`src/modes/rpc/rpc-client.ts`](../../src/modes/rpc/rpc-client.ts).

Treat unknown events/fields as forward-compatible: log them and retain raw JSON. Do not crash parser. For reconnect/restart, respawn child then rebuild from `get_state`, `get_entries`, and/or `get_messages`; stdout events are not replayable.

## Extension UI bridge

Extensions can request GUI interaction over same JSONL stream:

1. Receive `extension_ui_request` with unique `id`.
2. For `select`, `confirm`, `input`, `editor`, present native GUI modal.
3. Send `extension_ui_response` using matching id and `value`, `confirmed`, or `cancelled: true`.
4. Render `notify`, `setStatus`, `setWidget`, `setTitle`, and `set_editor_text` as fire-and-forget host UI changes.

A dialog blocks extension execution. On window close/disconnect, send `cancelled: true` for every pending request before stopping process; otherwise requests without timeout (notably `editor`) can hang. TUI-only custom components, editor reads, theme switching, autocomplete, raw terminal input, headers/footers, and tool expansion are unsupported/degraded in RPC mode. [Docs](../rpc.md#extension-ui-protocol), [`src/modes/rpc/rpc-mode.ts`](../../src/modes/rpc/rpc-mode.ts), [`examples/rpc-extension-ui.ts`](../../examples/rpc-extension-ui.ts).

## Security boundary

RPC grants control of an agent running with desktop-user permissions. It has no remote authentication because it is stdin/stdout. Security depends on process ownership and GUI IPC boundary.

- Keep child spawn, stdin writes, CLI flags, workspace path, and environment in Electron main/Rust backend only. Renderer/webview gets typed commands; never arbitrary executable/argument/environment access.
- Spawn without shell. Validate workspace path; give UI only agent instance IDs, not arbitrary process ids.
- Start with least privilege: `--no-tools` (or a narrow `--tools` allowlist), `--no-extensions`, and `--no-approve` for untrusted projects. Opt into trusted project resources explicitly with `--approve`.
- Pi project trust is an input-loading guard, not a sandbox. `AGENTS.md`/`CLAUDE.md` can still load; tools and extensions run as user. For unattended/untrusted work, run agent subprocess in OS/container/VM isolation with minimal mounts, network, and credentials. [Security](../security.md), [Containerization](../containerization.md).
- Never send provider secrets to renderer/webview logs, persisted UI state, or crash telemetry. Child inherits controlled main/backend environment.

## Electron vs Rust

| Concern | Electron | Rust/Tauri |
| --- | --- | --- |
| Child owner | main process `spawn(..., { shell: false, stdio: "pipe" })` | backend `tokio::process::Command`, piped stdio |
| UI bridge | preload `contextBridge` allowlisted API | Tauri commands/events, allowlisted API |
| JSONL parser | `StringDecoder` + LF scanner | byte `read_until(b'\n')` + UTF-8 decode |
| Shared rule | renderer never reads/writes child pipes | webview never reads/writes child pipes |

Choose framework on product/packaging needs, not RPC compatibility. Electron can reuse JS types/client logic; Rust gives a smaller native host. Both need same supervisor: child lifecycle, id map, JSONL parser, event reducer, extension-dialog broker, stderr ring buffer, restart/resync.

## Compatibility notes

Local implementation exceeds current prose docs. Feature-detect and pin agent version before relying on these source-backed additions:

- Commands in local types but absent from prose: `get_available_thinking_levels`, `set_auto_handoff`, `set_auto_handoff_threshold`, `get_entries`, and `get_tree`.
- Local events absent from prose: `agent_settled`, `entry_appended`, `session_info_changed`, `thinking_level_changed`, and summarization-retry events. Local `agent_end` adds `willRetry`.
- Fork config resolves `.selesai` (`piConfig.configDir`), while inherited docs still contain `.pi` examples. Never hardcode either; launch Selesai and use its resolver/session responses. [`package.json`](../../package.json), [`src/config.ts`](../../src/config.ts).

## Phase-1 acceptance checks

1. Spawn one agent with `--mode rpc --no-session`; send `get_state`; route response by id.
2. Prompt text containing U+2028/U+2029; confirm one JSONL request/event sequence, no record split.
3. Render streamed text and a tool call; abort mid-run; wait for `agent_settled`.
4. Load demo extension and complete/cancel each extension UI request. [`examples/extensions/rpc-demo.ts`](../../examples/extensions/rpc-demo.ts).
5. Kill/restart child; rebuild UI state through read commands, without assuming event replay.
6. Run on Windows, macOS, Linux; verify close/restart leaves no orphan agent process.

## Sources

1. [Pi RPC documentation](https://pi.dev/docs/latest/rpc) — external protocol reference supplied in request.
2. [`docs/rpc.md`](../rpc.md) — repository RPC specification and examples.
3. [`src/modes/rpc/rpc-types.ts`](../../src/modes/rpc/rpc-types.ts) — local command/response/UI schemas.
4. [`src/modes/rpc/rpc-mode.ts`](../../src/modes/rpc/rpc-mode.ts) and [`src/modes/rpc/jsonl.ts`](../../src/modes/rpc/jsonl.ts) — framing, lifecycle, extension bridge.
5. [`src/core/agent-session.ts`](../../src/core/agent-session.ts) and [`src/core/output-guard.ts`](../../src/core/output-guard.ts) — event semantics and stdout behavior.
6. [`docs/security.md`](../security.md), [`docs/containerization.md`](../containerization.md) — trust and isolation limits.
