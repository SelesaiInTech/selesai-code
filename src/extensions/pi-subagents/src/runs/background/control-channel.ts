/**
 * Cross-OS control channel for async subagent runs.
 *
 * Background runs are detached OS processes. The original control path delivered
 * an interrupt with `process.kill(pid, SIGUSR2|SIGBREAK)`, but Windows cannot
 * deliver those signals cross-process via `process.kill` and throws `ENOSYS`,
 * which left async runs uninterruptible (no stop, no live steer) on Windows.
 *
 * This module adds a portable, file-based control inbox inside the run directory.
 * The parent drops an interrupt request file; the runner watches the inbox and
 * routes the request into its existing graceful `interruptRunner()` (pause +
 * resumable), identically on every platform. The OS signal is kept only as an
 * opportunistic fast-path; its failure is non-fatal because the file inbox is
 * authoritative.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { writeAtomicJson } from "../../shared/atomic-json.ts";
import { POLL_INTERVAL_MS } from "../../shared/types.ts";

/**
 * Opportunistic fast-path interrupt signal. On Unix `SIGUSR2` is trapped by the
 * runner; on Windows `process.kill(pid, "SIGBREAK")` is not deliverable
 * cross-process and throws `ENOSYS`, so the file inbox below is the real channel.
 */
export const INTERRUPT_SIGNAL: NodeJS.Signals = process.platform === "win32" ? "SIGBREAK" : "SIGUSR2";

export type ControlChannelFs = Pick<typeof fs, "mkdirSync" | "existsSync" | "rmSync" | "watch">;
export type ControlChannelTimers = { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
type KillFn = (pid: number, signal?: NodeJS.Signals | 0) => unknown;

export interface InterruptRequest {
	type: "interrupt";
	ts?: number;
	source?: string;
	reason?: string;
}

/** Control inbox directory inside an async run dir. */
export function controlInboxDir(asyncDir: string): string {
	return path.join(asyncDir, "control");
}

/** Path of the portable interrupt request file. */
export function interruptRequestPath(asyncDir: string): string {
	return path.join(controlInboxDir(asyncDir), "interrupt.json");
}

/**
 * Parent side: drop a portable interrupt request the runner's inbox watcher will
 * pick up regardless of OS. Written atomically (temp + rename), dir auto-created.
 */
export function requestAsyncInterrupt(
	asyncDir: string,
	payload: Omit<InterruptRequest, "type"> = {},
	deps: { now?: () => number } = {},
): string {
	const requestPath = interruptRequestPath(asyncDir);
	const request: InterruptRequest = { ...payload, ts: payload.ts ?? deps.now?.() ?? Date.now(), type: "interrupt" };
	writeAtomicJson(requestPath, request);
	return requestPath;
}

/**
 * Runner side: consume a pending interrupt request. Idempotent — removes the file
 * so each distinct request fires exactly once. Returns whether one was pending.
 */
export function consumeInterruptRequest(
	asyncDir: string,
	fsImpl: Pick<typeof fs, "existsSync" | "rmSync"> = fs,
): boolean {
	const requestPath = interruptRequestPath(asyncDir);
	if (!fsImpl.existsSync(requestPath)) return false;
	try {
		fsImpl.rmSync(requestPath, { force: true, recursive: true });
	} catch {
		// Already removed by a concurrent check — still counts as consumed.
	}
	return true;
}

/**
 * Parent side: portable interrupt = authoritative file request + best-effort OS
 * signal. The signal is only a latency optimization on Unix; ENOSYS on Windows
 * is swallowed because the file inbox is authoritative there. Other signal
 * failures are surfaced because they usually mean the runner is not alive to
 * consume the request.
 */
export function deliverInterruptRequest(input: {
	asyncDir: string;
	pid?: number;
	kill?: KillFn;
	signal?: NodeJS.Signals;
	now?: () => number;
	source?: string;
}): void {
	const requestPath = requestAsyncInterrupt(input.asyncDir, input.source ? { source: input.source } : {}, { now: input.now });
	if (typeof input.pid === "number" && input.pid > 0) {
		try {
			(input.kill ?? process.kill)(input.pid, input.signal ?? INTERRUPT_SIGNAL);
		} catch (error) {
			if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOSYS") {
				// File inbox is authoritative when custom cross-process signals are unavailable.
				return;
			}
			try {
				fs.rmSync(requestPath, { force: true });
			} catch {
				// Best effort cleanup; the caller still gets the signal failure.
			}
			throw error;
		}
	}
}

/**
 * Runner side: watch the control inbox and route interrupt requests into
 * `onInterrupt`. Uses `fs.watch` when available plus an interval poll as a
 * portable safety net (covers filesystems/platforms where `fs.watch` is
 * unreliable). Fires once per distinct request. Returns a disposer.
 */
export function watchAsyncControlInbox(
	asyncDir: string,
	opts: {
		onInterrupt: () => void;
		pollIntervalMs?: number;
		fs?: ControlChannelFs;
		timers?: ControlChannelTimers;
	},
): () => void {
	const fsImpl = opts.fs ?? fs;
	const timers = opts.timers ?? { setInterval, clearInterval };
	const dir = controlInboxDir(asyncDir);
	try {
		fsImpl.mkdirSync(dir, { recursive: true });
	} catch {
		// Best effort — the poll/watch below tolerates a missing dir.
	}

	let disposed = false;
	const check = (): void => {
		if (disposed) return;
		try {
			if (consumeInterruptRequest(asyncDir, fsImpl)) opts.onInterrupt();
		} catch {
			// Never let inbox errors crash the runner.
		}
	};

	// Handle a request that may have arrived before the watcher started.
	check();

	let watcher: fs.FSWatcher | undefined;
	try {
		watcher = fsImpl.watch(dir, () => check());
		watcher.on?.("error", () => {
			// fs.watch can emit on transient FS errors; the interval poll keeps us live.
		});
	} catch {
		watcher = undefined;
	}

	const interval = timers.setInterval(check, opts.pollIntervalMs ?? POLL_INTERVAL_MS);
	interval.unref?.();

	return () => {
		if (disposed) return;
		disposed = true;
		try {
			watcher?.close();
		} catch {
			// ignore
		}
		timers.clearInterval(interval);
	};
}
