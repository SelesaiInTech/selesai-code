# Implementation Plan

## Goal

Formalize the existing RPC mode as the future desktop integration protocol: a versioned, local stdio/JSONL connection API with handshake, lifecycle, typed errors, event semantics, and a supported `RpcClient`. Do not build a desktop app, socket server, or remote API.

Finished result: a desktop main process can spawn `dist/rpc-entry.js`, complete a v1 handshake, proxy commands/events to its renderer through the desktop framework’s IPC, and shut down cleanly.

## Findings

- `src/cli.ts` starts `main()`, which parses `--mode rpc` in `src/cli/args.ts` and dispatches to `runRpcMode()` in `src/main.ts`.
- `src/rpc-entry.ts` already provides a dedicated executable entrypoint for RPC mode.
- `src/modes/rpc/rpc-mode.ts` is the existing transport seam: strict JSONL over stdin/stdout, request IDs, streamed `AgentSessionEvent`s, extension UI request/response support, session rebinding, backpressure, and signal/EOF cleanup.
- `src/modes/rpc/rpc-types.ts` defines the current command/response contract, but has no protocol version, hello/ready lifecycle, runtime validation, or structured error code.
- `src/modes/rpc/rpc-client.ts` is the reusable subprocess client but currently waits a fixed 100 ms, has no readiness negotiation, and exposes only `AgentSessionEvent` despite extension UI frames also arriving.
- `src/core/agent-session.ts` is shared by interactive, print, and RPC modes; its events should remain the source of streamed agent state rather than duplicating agent behavior for desktop.
- `src/core/auth-storage.ts` stores credentials locally with restrictive file modes. RPC should not transmit API keys or introduce a second authentication system.
- `docs/rpc.md` documents the transport but needs an authoritative desktop lifecycle, compatibility, versioning, event, error, and security contract.
- No TCP/WebSocket/HTTP listener exists or is needed. Parent-child stdio keeps the desktop integration inside the local OS-user boundary.

## Steps

1. **`src/modes/rpc/rpc-types.ts` — make this the single protocol contract.**
   - Add `RPC_PROTOCOL_VERSION = 1`, supported capability constants, `RpcReady`, `hello`, and `shutdown` message types.
   - Define a `RpcErrorCode` vocabulary such as `invalid_json`, `invalid_request`, `unsupported_protocol_version`, `unsupported_command`, `invalid_state`, `not_found`, and `internal_error`.
   - Preserve the existing `error: string` response field for compatibility and add optional `errorCode`, avoiding an unnecessary breaking response-shape migration.
   - Add TypeBox-backed inbound schemas/compiled validators for commands and `extension_ui_response`; validate request IDs, command discriminants, enums, required primitive fields, and dialog response shapes before dispatch. Reuse the installed `typebox` dependency; add no package.
   - Export a narrow parser/validator result used by the runtime rather than casting parsed JSON to `RpcCommand`.

2. **`src/modes/rpc/rpc-mode.ts` — implement the local connection lifecycle around the existing session API.**
   - Emit a `rpc_ready` JSONL frame before extension binding can emit UI requests. Include protocol version, supported versions/capabilities, server package version, and `transport: "stdio-local"`.
   - Handle `hello` by validating the requested protocol version and returning negotiated version, capabilities, local-only authentication posture, and a current `RpcSessionState` snapshot.
   - Keep command-first clients working as legacy behavior, but document `hello` as mandatory for new desktop clients; do not silently reinterpret legacy commands.
   - Add `shutdown`: send its success response, flush stdout, dispose the runtime, and exit through the existing cleanup path. EOF and signals remain valid fallback shutdown mechanisms.
   - Replace unsafe parsed-object casts with the new validator and return protocol-safe errors without stack traces. Validate extension UI replies before resolving a pending dialog; ignore stale reply IDs.
   - Serialize normal command dispatch in input order while allowing extension UI replies to bypass the queue, preventing state-command races and dialog deadlocks. Specify that responses/events may still interleave and must be correlated by request ID.
   - Retain the existing raw `AgentSessionEvent` stream, extension UI frames, stdout takeover, session rebind behavior, and backpressure handling; do not add a parallel event bus or transport.

3. **`src/modes/rpc/rpc-client.ts` — make the packaged client a desktop-main-process-ready adapter.**
   - Replace the startup delay with waiting for `rpc_ready`, then send `hello` for protocol v1 and reject unsupported/malformed negotiation.
   - Broaden the exported event type to include agent events, `rpc_ready`, and `extension_ui_request` frames.
   - Add a public method to send validated `extension_ui_response` frames so a desktop host can render extension dialogs and return the user’s answer.
   - Change `stop()` to request graceful `shutdown` first, then retain SIGTERM/SIGKILL as timeout fallbacks.
   - Continue correlating normal responses by request ID and surface `errorCode` with the existing error message.

4. **`src/modes/index.ts` and `src/index.ts` — expose the shared API.**
   - Re-export the new protocol constants and public types (`RpcReady`, `RpcErrorCode`, broadened RPC event type, and extension UI response type) alongside the existing `RpcClient` and RPC types.
   - Keep `AgentSession`/SDK exports unchanged; an in-process SDK remains an option for trusted Node hosts, while desktop packaging should prefer the process boundary.

5. **`docs/rpc.md` — document the desktop connection contract.**
   - Update commands/examples from the inherited `pi` name to this package’s `selesai` naming where applicable.
   - Document strict LF-only JSONL framing, first-frame `rpc_ready`, v1 `hello`, request IDs, capability negotiation, `shutdown`, process exit/EOF behavior, and command/event interleaving.
   - Define the compatibility policy: additive fields are allowed within v1; incompatible changes require a new protocol version negotiated by `hello`; command-first legacy behavior is deprecated but retained.
   - Document all emitted session event families, including `agent_settled`, `entry_appended`, `session_info_changed`, and `thinking_level_changed`, and state that events are not replayed. A reconnecting UI must restore state via persisted session selection plus `get_state`, `get_entries`, or `get_messages`.
   - Document error codes, the stable human-readable `error` field, and that successful prompt acceptance does not guarantee a later model/tool success.
   - Add a desktop integration section: desktop **main process** owns `rpc-entry`, validates/proxies frames to the renderer via the framework’s own IPC, keeps credentials and raw filesystem/tool payloads out of renderer globals, and renders extension UI requests before replying.
   - State security boundaries: stdio is local parent-child IPC only; credentials remain in host-managed auth storage/environment; do not pass API keys in RPC messages; no network listener is provided. A future remote product must be a separate authenticated, TLS-protected gateway with authorization, origin/client policy, and a deliberate exposure review—not a wrapper around this raw protocol.
   - State that the desktop must respect existing noninteractive project-trust behavior and obtain user approval before launching with `--approve`; project trust is not a sandbox.

6. **Add focused protocol regression tests.**
   - **`src/modes/rpc/rpc-types.test.ts`**: cover valid hello/command/UI-response parsing; invalid JSON-shape fields, invalid IDs, invalid enum values, unknown commands, and unsupported protocol versions producing safe error codes.
   - **`src/modes/rpc/rpc-client.test.ts`**: use a minimal temporary JSONL child fixture to verify `RpcClient.start()` waits for ready, sends hello, exposes extension UI frames, sends a UI response, and performs graceful shutdown.
   - **`src/modes/rpc/jsonl.test.ts`**: lock down LF-only framing, CRLF tolerance, split UTF-8 chunks, and preservation of U+2028/U+2029 inside JSON strings.

7. **Build, verify, and review the final narrow diff.**
   - Ensure no desktop framework dependency, network listener, authentication token scheme, renderer code, or duplicate agent/session layer was introduced.
   - Have the required reviewer check the negotiated lifecycle, validation boundary, backward compatibility behavior, credential exposure guidance, and test coverage before acceptance.

## Verification

- Success cases:
  - A v1 client receives `rpc_ready`, completes `hello`, receives the advertised capabilities/state, issues `get_state`, and exits after a successful `shutdown`.
  - `RpcClient` starts without timing assumptions, receives streamed agent and extension UI events, correlates responses, and tears down cleanly.
  - Existing command-first JSONL clients still receive the current command/event behavior.
  - A valid `extension_ui_response` resolves only its matching pending dialog.
  - Session replacement (`new_session`, `switch_session`, `fork`) continues to rebind event delivery.

- Failure/regression cases:
  - Malformed JSON, invalid command objects, invalid request IDs, unsupported protocol versions, and malformed UI responses produce safe protocol errors and do not crash the process.
  - Unknown/stale extension dialog response IDs do not resolve another request.
  - Concurrent state-changing commands are dispatched in input order; dialog responses do not deadlock behind a waiting command.
  - Shutdown flushes its acknowledgment and disposes the session; SIGTERM/EOF remain safe fallback paths.
  - No RPC message or ready frame contains API keys, auth-file contents, or stack traces.

- Commands:
  - `npm run build`
  - `npx vitest run src/modes/rpc/rpc-types.test.ts src/modes/rpc/rpc-client.test.ts src/modes/rpc/jsonl.test.ts`
  - `npx vitest run`
  - On a configured local development profile: pipe `hello`, `get_state`, and `shutdown` JSONL records to `node dist/rpc-entry.js --no-session`; confirm `rpc_ready` is first, hello succeeds, and the process exits cleanly.
  - Review with `git diff --check` and `git diff --cached --exit-code`.

## Risks / Open Questions

- The repository currently has an externally documented command-first RPC protocol. Retaining legacy behavior avoids an unnecessary break; the release notes should state when, if ever, it will be removed.
- Raw agent events can contain workspace content, tool output, and model thinking. Desktop implementations must keep child-process ownership and payload filtering in the privileged main process.
- Remote/multi-user operation is intentionally out of scope. It requires product decisions about identity, authorization, tenant isolation, secret storage, audit logging, and network deployment.
- RPC mode remains unsandboxed and runs with the launching user’s permissions; project trust does not mitigate tool or prompt-injection risk.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The plan reuses the existing RPC stdio transport, AgentSession event stream, rpc-entry executable, and RpcClient; it explicitly excludes a desktop app, sockets, server, and new dependencies."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Planning-only task: repository architecture and existing RPC transport, client, types, docs, auth storage, and security guidance were inspected; no implementation validation was run."
  ],
  "residualRisks": [
    "Protocol compatibility and any future remote exposure require release and product decisions.",
    "No code was changed because this task requested a plan only."
  ],
  "noStagedFiles": true,
  "diffSummary": "No implementation diff; the plan identifies the minimal proposed production and test files.",
  "reviewFindings": [
    "No blockers in the planned approach; reviewer must gate the implementation for local-only security boundaries, legacy compatibility, and handshake/error validation."
  ],
  "manualNotes": "The parent session will persist this planning artifact at the required path."
}
```

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 8b8e7f