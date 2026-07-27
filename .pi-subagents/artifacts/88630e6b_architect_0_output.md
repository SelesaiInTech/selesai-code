# Implementation Plan

## Goal
Make the existing RPC mode the documented, versioned local connection protocol for a future desktop app—without adding a desktop app, daemon, socket server, or new dependency.

## Findings
- `src/modes/rpc/rpc-mode.ts` already provides bidirectional JSONL over stdin/stdout, streams `AgentSessionEvent`s, supports request IDs, cancellation, session operations, and extension UI request/response.
- `src/modes/rpc/rpc-types.ts` is the protocol’s TypeScript contract; `src/modes/rpc/rpc-client.ts` is a reusable Node-process client.
- `src/rpc-entry.ts` and `selesai --mode rpc` start the headless process. `docs/rpc.md` documents most behavior, but has no protocol negotiation/version contract or desktop security boundary guidance.
- Keep the boundary local: a desktop main process owns the child process and exposes a narrowed IPC bridge to its renderer. Do not expose the raw RPC process over TCP/WebSocket.

## Steps
1. **`src/modes/rpc/rpc-types.ts`** — Add `RPC_PROTOCOL_VERSION = 1`, a `hello` command, and its typed response containing the negotiated protocol version, package version, and supported capabilities (commands, events, extension UI).
2. **`src/modes/rpc/rpc-mode.ts`** — Handle `hello` before normal session commands. Reject incompatible requested versions with the existing failed-response envelope and a stable error code/message. Preserve every existing command unchanged for backward compatibility.
3. **`src/modes/rpc/rpc-client.ts`** — Add `hello()` so a desktop host can wait for readiness and verify compatibility before rendering or forwarding user actions. Do not make `start()` implicitly negotiate, which would break existing consumers.
4. **`docs/rpc.md`** — Add a “Desktop host contract” section:
   - Spawn `selesai --mode rpc` as a long-lived child process; use strict LF-delimited UTF-8 JSONL.
   - Send `hello` first, correlate replies by `id`, render streamed events, and resolve outstanding extension UI dialogs by their IDs.
   - Treat `agent_settled` as completion, use `abort` for cancellation, and restart/recover on child-process exit.
   - State that credentials remain in Selesai’s local auth storage; do not pass provider secrets through renderer IPC or stdout.
   - Specify Electron/Tauri-style ownership: main/backend process owns stdio; renderer receives only validated, allowlisted commands/events.
   - Explicitly defer remote access. A future remote adapter must add TLS, authenticated identities, authorization policy, rate limits, and must not expose arbitrary `bash` unchanged.
5. **`src/modes/rpc/rpc-types.test.ts`** — Add focused tests for successful version negotiation, unsupported-version failure, capability stability, and compile-time command/response typing.
6. Update the RPC documentation examples to use the shipped `selesai` launcher where they describe this package, while leaving generic upstream type references untouched.

## Verification
- Run `npm run build`.
- Run `npx vitest run src/modes/rpc/rpc-types.test.ts`.
- Manual smoke test in a configured development environment: start `selesai --mode rpc`, send `hello`, confirm a versioned response, then send `get_state` and verify its correlated response.
- Regression checks: existing clients that do not call `hello` still use all prior commands; malformed JSON still produces a parse-error response; extension UI dialog IDs remain round-trippable.

## Risks / Open Questions
- The current protocol intentionally grants powerful local capabilities, including shell execution. A desktop renderer must never receive unrestricted raw stdin access.
- Package semver and protocol version are distinct; future incompatible protocol changes must increment `RPC_PROTOCOL_VERSION`.
- Remote/multi-user use is intentionally out of scope and needs a separate security design.

WORKFLOW_PLAN_STATUS: ready

⧉ copy assistant: /cp 37d829