// RTK Pi extension — rewrites bash commands to use rtk for token savings.
// RTK is provisioned into Selesai's managed binary directory when it is missing.
//
// This is a thin delegating extension: all rewrite logic lives in `rtk rewrite`,
// which is the single source of truth (src/discover/registry.rs).
// To add or change rewrite rules, edit the Rust registry — not this file.
//
// Exit code contract for `rtk rewrite`:
//   0 + stdout  Rewrite found → mutate command
//   1           No RTK equivalent → pass through unchanged
//   3 + stdout  Rewrite (advisory) → mutate command

import type { ExtensionAPI } from "@selesai/code"
import { ensureTool, isToolCallEventType } from "@selesai/code"

const REWRITE_TIMEOUT_MS = 2_000
const MIN_SUPPORTED_RTK_MINOR = 23

// Parse "X.Y.Z" from either `rtk --version` output or a diagnostic string.
export function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

async function probeRtk(pi: ExtensionAPI, rtkPath: string): Promise<boolean> {
  const ver = await pi.exec(rtkPath, ["--version"], { timeout: REWRITE_TIMEOUT_MS })
  if (ver.code !== 0) {
    console.warn("[rtk] managed binary failed --version — extension disabled")
    return false
  }

  const parsed = parseSemver(ver.stdout)
  if (!parsed) {
    console.warn(`[rtk] could not parse version from ${ver.stdout.trim() || "<empty output>"} — extension disabled`)
    return false
  }

  const [major, minor] = parsed
  if (major === 0 && minor < MIN_SUPPORTED_RTK_MINOR) {
    console.warn(`[rtk] ${ver.stdout.trim()} is too old (need >= 0.23.0) — extension disabled`)
    return false
  }

  // `rtk` is also the name of an unrelated Rust Type Kit project. `gain` is
  // the upstream RTK Token Killer identity check and prevents that collision.
  const identity = await pi.exec(rtkPath, ["gain"], { timeout: REWRITE_TIMEOUT_MS })
  if (identity.code !== 0) {
    console.warn("[rtk] binary is not rtk-ai/rtk (rtk gain failed) — extension disabled")
    console.warn("[rtk] install Rust Token Killer from https://github.com/rtk-ai/rtk")
    return false
  }

  return true
}

// Calls `rtk rewrite`; returns the rewritten command or null (pass through).
async function rewriteCommand(
  pi: ExtensionAPI,
  rtkPath: string,
  cmd: string,
  signal?: AbortSignal
): Promise<string | null> {
  const result = await pi.exec(rtkPath, ["rewrite", cmd], {
    timeout: REWRITE_TIMEOUT_MS,
    signal,
  })
  if (result.killed) return null
  if (result.code !== 0 && result.code !== 3) return null
  return result.stdout.trim() || null
}

export default function (pi: ExtensionAPI) {
  // Explicit opt-out must also prevent an automatic managed-binary download.
  if (process.env.RTK_DISABLED === "1") return

  // Provisioning may download the managed binary from GitHub (with 120s timeouts)
  // and probe system binaries. Running it in the extension factory would block the
  // whole startup on a slow/unreachable network, so defer it off the critical path.
  // Bash commands issued before the hook registers simply pass through un-rewritten.
  void (async () => {
    let rtkPath: string | undefined
    try {
      rtkPath = await ensureTool("rtk")
    } catch (err) {
      console.warn(`[rtk] managed installation failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!rtkPath) {
      console.warn("[rtk] unavailable; install from https://github.com/rtk-ai/rtk")
      return
    }

    try {
      if (!(await probeRtk(pi, rtkPath))) return
    } catch (err) {
      console.warn(`[rtk] verification failed: ${err instanceof Error ? err.message : String(err)} — extension disabled`)
      return
    }

    pi.on("tool_call", async (event, ctx) => {
      try {
        if (!isToolCallEventType("bash", event)) return

        const cmd = event.input.command
        if (typeof cmd !== "string" || cmd.trim() === "") return

        if (cmd.trimStart().startsWith("rtk ")) return
        if (process.env.RTK_DISABLED === "1") return

        // Delegate to RTK.
        const rewritten = await rewriteCommand(pi, rtkPath, cmd, ctx.signal)
        if (rewritten && rewritten !== cmd) {
          event.input.command = rewritten
        }
      } catch (err) {
        // Fail open: never block execution on an unexpected error.
        console.warn("[rtk] unexpected error in tool_call handler; passing through command", err)
        return
      }
    })
  })()
}
