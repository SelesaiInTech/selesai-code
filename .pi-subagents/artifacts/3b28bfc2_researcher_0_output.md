# Research: Pi RPC

## Summary

Pi RPC is a headless JSONL protocol over stdin/stdout: `pi --mode rpc`. Commands are one JSON object per LF-delimited line; responses and async events stream back as JSONL on stdout. The primary docs at `https://pi.dev/docs/latest/rpc` were not retrievable during research; the authoritative local docs and implementation are in `docs/rpc.md`, `src/modes/rpc/jsonl.ts`, `src/modes/rpc/rpc-types.ts`, and `src/modes/rpc/rpc-mode.ts`.

## Findings

1. **Wire protocol / framing** — Strict JSONL with LF (`\n`) as the only record delimiter. Clients must split on `\n`, strip optional trailing `\r`, and avoid generic line readers like Node `readline` because they split on `U+2028`/`U+2029`, which are valid inside JSON strings. Serialization is via `serializeJsonLine()`. [Source: `src/modes/rpc/jsonl.ts`]

2. **Startup / lifecycle** — Start with `pi --mode rpc [options]`: `--provider`, `--model`, `--name`/`-n`, `--no-session`, `--session-dir`. Node.js clients are advised to use `AgentSession` directly instead of spawning a subprocess; for subprocess clients, use `RpcClient`. Lifecycle: bind session, attach JSONL reader, process commands until stdin ends or shutdown signal, dispose runtime. SIGTERM/SIGHUP handlers clean up detached children and call `shutdown()`. [Source: `docs/rpc.md`, `src/modes/rpc/rpc-client.ts`, `src/modes/rpc/rpc-mode.ts`]

3. **Request / event schemas and IDs** — Commands are `{ id?, type, ... }` on stdin. Responses are `{ id?, type: "response", command, success, data? | error? }`; `id` echoes the request id when supplied. Events are `{ type: "agent_start" | "agent_end" | "turn_start" | "turn_end" | "message_start" | "message_update" | "message_end" | "tool_execution_*" | "queue_update" | "compaction_*" | "auto_retry_*" | "extension_error" }` and do NOT include an `id`. [Source: `docs/rpc.md`, `src/modes/rpc/rpc-types.ts`]

4. **Streaming** — `prompt` returns an immediate response once preflight accepts/queues the message, then events stream asynchronously. `message_update` carries `assistantMessageEvent` delta types: `start`, `text_start`/`text_delta`/`text_end`, `thinking_*`, `toolcall_*`, `done`, `error`. `tool_execution_update` delivers accumulated partial results on each update. If the agent is already streaming, a prompt must specify `streamingBehavior: "steer"` or `"followUp"`. [Source: `docs/rpc.md`, `src/modes/rpc/rpc-mode.ts`]

5. **Configuration / permission flow** — Runtime configuration is controlled by commands: `set_model`, `set_thinking_level`, `set_steering_mode`, `set_follow_up_mode`, `set_auto_compaction`, `set_auto_handoff`, `set_auto_handoff_threshold`, `set_auto_retry`, `set_session_name`. Permission/decision UI is delegated via the extension UI sub-protocol: extensions emit `extension_ui_request` and block on a matching `extension_ui_response` for dialog methods (`select`, `confirm`, `input`, `editor`). [Source: `docs/rpc.md`, `src/modes/rpc/rpc-types.ts`]

6. **Auth / security boundaries** — No dedicated RPC auth mechanism is described. Security boundary is OS process boundary: the client must spawn and own the `pi` process, so access to stdin/stdout equals full control. Extensions run inside the agent and can request user decisions via dialog UI; fire-and-forget UI calls and bash execution are gated by the host/client. [Source: `docs/rpc.md`, `src/modes/rpc/rpc-mode.ts`]

7. **Known GUI integration limitations** — In RPC mode, TUI-only methods are degraded/no-ops: `custom()` returns `undefined`; `setWorkingMessage`, `setWorkingIndicator`, `setFooter`, `setHeader`, `setEditorComponent`, `setToolsExpanded` are no-ops; `getEditorText()` returns `""`; `getToolsExpanded()` returns `false`; `pasteToEditor()` falls back to `setEditorText`; `getAllThemes()` returns `[]`; `getTheme()` returns `undefined`; `setTheme()` returns `{ success: false, error: ... }`. Built-in TUI commands (`/settings`, `/hotkeys`, etc.) are excluded from `get_commands`. `ctx.mode === "rpc"` and `ctx.hasUI === true` because dialog/fire-and-forget methods still work. [Source: `docs/rpc.md`]

8. **Recommended Electron/Rust topology** — Primary doc/source drift means no explicit official Electron/Rust recommendation was found. From the protocol, the recommended topology is:
   - **Electron**: spawn `pi --mode rpc` as a hidden Node child process, connect its stdin/stdout to the main process, forward JSONL to the renderer over IPC. Electron guides the safest sandbox model by spawning the Pi agent in the main process (Node) and exposing only a controlled JSONL bridge to the renderer. Implement prompts/notifications using the extension UI sub-protocol.
   - **Rust**: spawn `pi` via `std::process::Command` with piped stdin/stdout, parse JSONL with byte-delimited `\n` framing, and route events through Rust channels to the UI thread. Rust should not add extra network/HTTP layer over the local process pipes unless needed for renderer separation.
   [Sources: `docs/rpc.md`, `src/modes/rpc/rpc-client.ts`, `src/modes/rpc/jsonl.ts`]

## Sources
- Kept: local docs/rpc.md — complete protocol reference.
- Kept: local src/modes/rpc/rpc-types.ts — TypeScript schemas for commands, responses, extension UI requests/responses.
- Kept: local src/modes/rpc/rpc-mode.ts — runtime implementation and lifecycle.
- Kept: local src/modes/rpc/rpc-client.ts — reference client implementation.
- Kept: local src/modes/rpc/jsonl.ts — strict framing serialization/reader.
- Gap: https://pi.dev/docs/latest/rpc — not retrievable during research.

## Gaps
- Primary web docs `https://pi.dev/docs/latest/rpc` returned no usable evidence; rely on local docs and implementation.
- No explicit official Electron or Rust client topology was found; recommendation is inferred from the JSONL subprocess model.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Scoped to Pi RPC wire protocol, lifecycle, schemas, streaming, config/permission flow, auth/security, GUI limitations, and Electron/Rust topology without unrelated exploration or implementation."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Cited exact local source paths: docs/rpc.md, src/modes/rpc/jsonl.ts, src/modes/rpc/rpc-types.ts, src/modes/rpc/rpc-mode.ts, src/modes/rpc/rpc-client.ts. Flagged unreachable primary docs."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Primary docs (https://pi.dev/docs/latest/rpc) were not retrievable; local docs appear current and consistent with source code."
  ],
  "residualRisks": [
    "Web documentation may differ from local doc; recommend verifying against pi.dev for any schema changes before final integration.",
    "No file write was possible due to tool availability; content is returned inline per supervisor direction."
  ],
  "noStagedFiles": true,
  "diffSummary": "No code changes; research brief produced only.",
  "reviewFindings": [
    "no blockers"
  ],
  "manualNotes": "File write to /tmp/pi-rpc-research-2.md was not possible with available tools; supervisor instructed returning markdown inline. The Electron/Rust topology is inferred from the protocol since no official topology doc was found."
}
```

⧉ copy assistant: /cp 11d691