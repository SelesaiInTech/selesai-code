/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */

import * as crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import { generateHandoff } from "../../core/handoff.ts";
import { buildGitCommandPrompt } from "../../core/git-command.ts";
import { KeybindingsManager } from "../../core/keybindings.ts";
import { SessionManager } from "../../core/session-manager.ts";
import { resolveModelScope } from "../../core/model-resolver.ts";
import { refreshModelCatalogs } from "../interactive/model-catalog-refresh.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { ProjectTrustStore, hasTrustRequiringProjectResources } from "../../core/trust-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../../core/slash-commands.ts";
import { createSyntheticSourceInfo } from "../../core/source-info.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { getChangelogPath, parseChangelog } from "../../utils/changelog.ts";
import { VERSION, getAgentDir, getBundledDefaultsDir, getShareViewerUrl } from "../../config.ts";
import { openBrowser } from "../../utils/open-browser.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import type { ImageContent } from "@earendil-works/pi-ai";
import { getAvailableThemesWithPaths, setRegisteredThemes } from "../interactive/theme/theme.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type { SessionTreeNode } from "../../core/session-manager.ts";
import type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionInfo,
	RpcSessionState,
	RpcSlashCommand,
	PrototypePhase,
	QuicktypePhase,
} from "./rpc-types.ts";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionInfo,
	RpcSessionState,
	RpcSlashCommand,
	PrototypePhase,
	QuicktypePhase,
	WorkflowState,
} from "./rpc-types.ts";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;

	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	/**
	 * Filter a session tree with the same semantics as the TUI tree selector
	 * (tree-selector.ts FilterMode). Hidden leaf pruning is preserved.
	 */
	const filterTree = (
		nodes: SessionTreeNode[],
		mode: "default" | "no-tools" | "user-only" | "labeled-only" | "all",
	): SessionTreeNode[] => {
		const passes = (node: SessionTreeNode): boolean => {
			const entry = node.entry;
			const isSettingsEntry =
				entry.type === "label" ||
				entry.type === "custom" ||
				entry.type === "model_change" ||
				entry.type === "thinking_level_change" ||
				entry.type === "session_info";
			switch (mode) {
				case "user-only":
					return entry.type === "message" && entry.message.role === "user";
				case "no-tools":
					return !isSettingsEntry && !(entry.type === "message" && entry.message.role === "toolResult");
				case "labeled-only":
					return node.label !== undefined;
				case "all":
					return true;
				default:
					return !isSettingsEntry;
			}
		};

		const visit = (nodes: SessionTreeNode[]): SessionTreeNode[] => {
			const result: SessionTreeNode[] = [];
			for (const node of nodes) {
				if (!passes(node)) continue;
				const children = visit(node.children);
				result.push({ ...node, children });
			}
			return result;
		};

		return visit(nodes);
	};

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	// Pending extension UI requests waiting for response
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();

	// Prompts buffered while compacting (queueWhileCompacting) — flushed after compaction_end.
	const compactionPromptQueue: Array<{
		message: string;
		images?: ImageContent[];
		streamingBehavior?: "steer" | "followUp";
	}> = [];

	// Shutdown request flag
	let shutdownRequested = false;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];

	/** Helper for dialog methods with signal/timeout support */
	function createDialogPromise<T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol.
	 */
	const createExtensionUIContext = (): ExtensionUIContext => ({
		select: (title, options, opts) =>
			createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		multiselect: (title, options, opts) =>
			createDialogPromise(opts, undefined, { method: "multiselect", title, options, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "values" in r ? r.values : undefined,
			),

		confirm: (title, message, opts) =>
			createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(message?: string): void {
			// Fire and forget - host renders the working loader row
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "working",
				...(message !== undefined ? { message } : {}),
			} as RpcExtensionUIRequest);
		},

		setWorkingVisible(visible: boolean): void {
			// Fire and forget - host shows/hides the working loader row
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "working",
				visible,
			} as RpcExtensionUIRequest);
		},

		setWorkingIndicator(options?: WorkingIndicatorOptions): void {
			// Fire and forget - host customizes the working indicator. Custom frames only
			// affect the normal streaming loader; compaction/retry keep built-in styling.
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "working",
				...(options?.frames !== undefined ? { frames: options.frames } : {}),
				...(options?.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {}),
			} as RpcExtensionUIRequest);
		},

		setHiddenThinkingLabel(_label?: string): void {
			// Hidden thinking label not supported in RPC mode - requires TUI message rendering access
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject,
				});
				output({ type: "extension_ui_request", id, method: "editor", title, prefill } as RpcExtensionUIRequest);
			});
		},

		addAutocompleteProvider(): void {
			// Autocomplete provider composition is not supported in RPC mode
		},

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		},

		getEditorComponent() {
			// Custom editor components not supported in RPC mode
			return undefined;
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			// Theme switching not supported in RPC mode
			return { success: false, error: "Theme switching not supported in RPC mode" };
		},

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		},

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		},
	});

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		await session.bindExtensions({
			uiContext: createExtensionUIContext(),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (options) => runtimeHost.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					return runtimeHost.switchSession(sessionPath, options);
				},
				reload: async () => {
					await session.reload();
				},
			},
			shutdownHandler: () => {
				shutdownRequested = true;
			},
			onError: (err) => {
				output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
			},
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribe = session.subscribe((event) => {
			output(event);
			if (event.type === "agent_settled") {
				void checkShutdownRequested();
			}
			if (event.type === "compaction_end" && compactionPromptQueue.length > 0) {
				// TUI flushCompactionQueue parity: replay buffered prompts after compaction finishes.
				// Completed compaction replays in-order (extension commands via prompt, rest by
				// their original streaming behavior); aborted compaction discards the buffer.
				if (event.aborted || event.errorMessage) {
					compactionPromptQueue.length = 0;
					return;
				}
				const queued = compactionPromptQueue.splice(0);
				void (async () => {
					for (const item of queued) {
						try {
							await session.prompt(item.message, {
								images: item.images,
								streamingBehavior: item.streamingBehavior,
								source: "rpc",
							});
						} catch {
							// Replay failures surface through agent error handling; do not kill the stream.
						}
					}
				})();
			}
		});
		unsubscribeBackpressure = session.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	await rebindSession();
	registerSignalHandlers();

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
		const id = command.id;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// Start prompt handling immediately, but emit the authoritative response only after
				// prompt preflight succeeds. Queued and immediately handled prompts also count as success.
				let preflightSucceeded = false;

				// During compaction: either buffer and auto-send after compaction_end (TUI parity),
				// or fail fast with a clear error when the caller did not opt in.
				if (session.isCompacting) {
					if (!command.queueWhileCompacting) {
						return error(
							id,
							"prompt",
							"Agent is compacting; set queueWhileCompacting:true to buffer this prompt and send it after compaction, or wait for compaction_end.",
						);
					}
					const queued = {
						message: command.message,
						images: command.images,
						streamingBehavior: command.streamingBehavior,
					};
					output(success(id, "prompt")); // accepted into the buffer
					compactionPromptQueue.push(queued);
					return undefined;
				}

				void session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
						preflightResult: (didSucceed) => {
							if (didSucceed) {
								preflightSucceeded = true;
								output(success(id, "prompt"));
							}
						},
					})
					.catch((e) => {
						if (!preflightSucceeded) {
							output(error(id, "prompt", e.message));
						}
					});
				return undefined;
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				// TUI Esc parity: cancel in-flight branch summarization and compaction as well,
				// not just the active agent turn (session.abort() alone covers retry + agent).
				session.abortBranchSummary();
				session.abortCompaction();
				await session.abort();
				return success(id, "abort");
			}

			case "clear_queue": {
				return success(id, "clear_queue", session.clearQueue());
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const result = await runtimeHost.newSession(options);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "new_session", result);
			}

			case "handoff_new": {
				if (!session.model) return error(id, "handoff_new", "No model selected");
				try {
					const handoff = await generateHandoff(session.model, session.modelRuntime, session.sessionManager.getBranch(), command.goal);
					const result = await runtimeHost.newSession({
						parentSession: session.sessionManager.getSessionFile(),
						withSession: async (replacementSession) => replacementSession.sendUserMessage(handoff),
					});
					if (!result.cancelled) await rebindSession();
					return success(id, "handoff_new", result);
				} catch (errorValue) {
					return error(id, "handoff_new", errorValue instanceof Error ? errorValue.message : String(errorValue));
				}
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					autoHandoffEnabled: session.autoHandoffEnabled,
					autoHandoffThresholdTokens: session.autoHandoffThresholdTokens,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
					steering: session.getSteeringMessages(),
					followUp: session.getFollowUpMessages(),
				};

				// Attach workflow state from latest workflow-phase entry, if active.
				// ponytail: linear scan of entries; workflow is short-lived so O(n) per get_state is fine.
				try {
					const entries = session.sessionManager.getEntries();
					for (let i = entries.length - 1; i >= 0; i--) {
						const e = entries[i] as { type: string; customType?: string; data?: unknown };
						const customType = e.customType;
						if (e.type === "custom" && (customType === "prototype-phase" || customType === "quicktype-phase") && e.data) {
							const d = e.data as { phase?: string; step?: number; done?: boolean };
							if (d && typeof d.phase === "string" && typeof d.step === "number" && !d.done) {
								state.workflow = {
									mode: customType === "prototype-phase" ? "prototype" : "quicktype",
									phase: d.phase as PrototypePhase | QuicktypePhase,
									step: d.step,
									done: false,
								};
							}
							break;
						}
					}
				} catch { /* corrupt entry must not crash get_state */ }

				return success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.modelRuntime.getAvailable();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel(command.direction ?? "forward");
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				if (command.refresh) {
					// TUI parity: refresh model catalogs before listing (shared coordinator).
					try {
						await refreshModelCatalogs(session.modelRuntime, AbortSignal.timeout(15_000));
					} catch {
						// Fall back to the current snapshot if the network refresh fails.
					}
				}
				const models = await session.modelRuntime.getAvailable();
				return success(id, "get_available_models", { models });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			case "get_available_thinking_levels": {
				const levels = session.getAvailableThinkingLevels();
				return success(id, "get_available_thinking_levels", { levels });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			case "replace_queue": {
				session.replaceQueue(command.steering, command.followUp);
				return success(id, "replace_queue");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			case "set_auto_handoff": {
				session.settingsManager.setAutoHandoffEnabled(command.enabled);
				return success(id, "set_auto_handoff");
			}

			case "set_auto_handoff_threshold": {
				const tokens = command.tokens;
				if (!Number.isFinite(tokens) || tokens < 1000) {
					return error(id, "set_auto_handoff_threshold", "Threshold must be at least 1000 tokens");
				}
				session.settingsManager.setAutoHandoffThresholdTokens(tokens);
				return success(id, "set_auto_handoff_threshold");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const eventResult = await session.extensionRunner.emitUserBash({
					type: "user_bash",
					command: command.command,
					excludeFromContext: command.excludeFromContext ?? false,
					cwd: session.sessionManager.getCwd(),
				});

				if (eventResult?.result) {
					session.recordBashResult(command.command, eventResult.result, {
						excludeFromContext: command.excludeFromContext,
					});
					return success(id, "bash", eventResult.result);
				}

				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
					id,
					operations: eventResult?.operations,
				});
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath, { themeName: command.themeName });
				return success(id, "export_html", { path });
			}

			case "switch_session": {
				const result = await runtimeHost.switchSession(command.sessionPath);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "switch_session", result);
			}

			case "fork": {
				const result = await runtimeHost.fork(command.entryId);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await runtimeHost.fork(leafId, { position: "at" });
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "clone", { cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return success(id, "get_fork_messages", { messages });
			}

			case "get_entries": {
				const sessionManager = session.sessionManager;
				let entries = sessionManager.getEntries();
				if (command.since !== undefined) {
					const sinceIndex = entries.findIndex((e) => e.id === command.since);
					if (sinceIndex === -1) {
						return error(id, "get_entries", `Entry not found: ${command.since}`);
					}
					entries = entries.slice(sinceIndex + 1);
				}
				return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
			}

			case "get_tree": {
				const sessionManager = session.sessionManager;
				const tree = sessionManager.getTree();
				const filter = command.filter ?? "default";
				const filtered = filter === "all" ? tree : filterTree(tree, filter);
				return success(id, "get_tree", { tree: filtered, leafId: sessionManager.getLeafId() });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return success(id, "set_session_name");
			}

			// =================================================================
			// Tree navigation
			// =================================================================

			case "navigate_tree": {
				if (session.isStreaming) {
					return error(
						id,
						"navigate_tree",
						"Wait for the current response to finish before navigating the session tree.",
					);
				}
				try {
					const result = await session.navigateTree(command.targetId, {
						summarize: command.summarize,
						customInstructions: command.customInstructions,
						replaceInstructions: command.replaceInstructions,
						label: command.label,
					});
					return success(id, "navigate_tree", {
						editorText: result.editorText,
						cancelled: result.cancelled,
						aborted: result.aborted,
						summaryEntry: result.summaryEntry ?? null,
					});
				} catch (navigationError: unknown) {
					return error(
						id,
						"navigate_tree",
						navigationError instanceof Error ? navigationError.message : String(navigationError),
					);
				}
			}

			// =================================================================
			// Session discovery / management
			// =================================================================

			case "list_sessions": {
				try {
					const sessionManager = session.sessionManager;
					const isAll = command.scope === "all";
					const source = isAll
						? sessionManager.usesDefaultSessionDir()
							? await SessionManager.listAll()
							: await SessionManager.listAll(sessionManager.getSessionDir())
						: await SessionManager.list(sessionManager.getCwd(), sessionManager.getSessionDir());
					const sessions = source.map((info) => ({
						path: info.path,
						id: info.id,
						cwd: info.cwd,
						name: info.name,
						parentSessionPath: info.parentSessionPath,
						created: Number.isNaN(info.created.getTime()) ? new Date(0).toISOString() : info.created.toISOString(),
						modified: Number.isNaN(info.modified.getTime()) ? new Date(0).toISOString() : info.modified.toISOString(),
						messageCount: info.messageCount,
						firstMessage: info.firstMessage,
					}));
					return success(id, "list_sessions", { sessions });
				} catch (listError: unknown) {
					return error(
						id,
						"list_sessions",
						listError instanceof Error ? listError.message : String(listError),
					);
				}
			}

			case "rename_session": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "rename_session", "Session name cannot be empty");
				}
				if (!existsSync(command.path)) {
					return error(id, "rename_session", `Session file not found: ${command.path}`);
				}
				try {
					const target = SessionManager.open(command.path);
					target.appendSessionInfo(name);
					return success(id, "rename_session", { path: command.path, name });
				} catch (renameError: unknown) {
					return error(
						id,
						"rename_session",
						renameError instanceof Error ? renameError.message : String(renameError),
					);
				}
			}

			case "delete_session": {
				if (command.path === session.sessionFile) {
					return error(id, "delete_session", "Cannot delete the currently active session.");
				}
				if (!existsSync(command.path)) {
					return error(id, "delete_session", `Session file not found: ${command.path}`);
				}
				try {
					// trash-CLI-first with unlink fallback (identical to the TUI session selector).
					const trashArgs = command.path.startsWith("-") ? ["--", command.path] : [command.path];
					const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });
					if (trashResult.status === 0 || !existsSync(command.path)) {
						return success(id, "delete_session", { path: command.path, method: "trash" });
					}
					unlinkSync(command.path);
					return success(id, "delete_session", { path: command.path, method: "unlink" });
				} catch (deleteError: unknown) {
					return error(
						id,
						"delete_session",
						deleteError instanceof Error ? deleteError.message : String(deleteError),
					);
				}
			}

			// =================================================================
			// Session-only scoped models (ephemeral, not persisted)
			// =================================================================

			case "set_session_models": {
				try {
					if (command.reorder !== undefined && command.reorder.length > 0) {
						// Reorder-only path: rebuild scope from the reordered pattern list.
						const scoped = await resolveModelScope(command.reorder, session.modelRuntime);
						session.setScopedModels(
							scoped.map((sm) => ({ model: sm.model, thinkingLevel: sm.thinkingLevel })),
						);
						return success(id, "set_session_models", {
							enabled: scoped.map((sm) => `${sm.model.provider}/${sm.model.id}`),
							models: scoped.map((sm) => sm.model),
						});
					}
					if (command.enabled === undefined) {
						return error(id, "set_session_models", "Provide either enabled or reorder.");
					}
					if (command.enabled.length === 0) {
						session.setScopedModels([]);
						return success(id, "set_session_models", { enabled: [], models: [] });
					}
					const patterns = command.enabled;
					const allModels = await session.modelRuntime.getAvailable();
					const allModelIds = new Set(allModels.map((model) => `${model.provider}/${model.id}`));
					const allEnabled = patterns.every((pattern) => allModelIds.has(pattern));
					if (allEnabled) {
						// Every enabled id resolves to a concrete model: build scope directly.
						const enabledSet = new Set(patterns);
						const scopedModels = allModels.filter((model) =>
							enabledSet.has(`${model.provider}/${model.id}`),
						);
						session.setScopedModels(scopedModels.map((model) => ({ model })));
						return success(id, "set_session_models", {
							enabled: scopedModels.map((model) => `${model.provider}/${model.id}`),
							models: scopedModels,
						});
					}
					// Patterns contain a scope/wildcard (e.g. "anthropic/*"): resolve against the registry.
					const scoped = await resolveModelScope(patterns, session.modelRuntime);
					session.setScopedModels(
						scoped.map((sm) => ({ model: sm.model, thinkingLevel: sm.thinkingLevel })),
					);
					return success(id, "set_session_models", {
						enabled: scoped.map((sm) => `${sm.model.provider}/${sm.model.id}`),
						models: scoped.map((sm) => sm.model),
					});
				} catch (scopeError: unknown) {
					return error(
						id,
						"set_session_models",
						scopeError instanceof Error ? scopeError.message : String(scopeError),
					);
				}
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const command of session.extensionRunner.getRegisteredCommands()) {
					commands.push({
						name: command.invocationName,
						description: command.description,
						source: "extension",
						sourceInfo: command.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				// Built-in TUI commands: display-only, cannot be invoked via prompt.
				for (const builtin of BUILTIN_SLASH_COMMANDS) {
					commands.push({
						name: builtin.name,
						description: builtin.description
							+ (builtin.argumentHint ? ` ${builtin.argumentHint}` : ""),
						source: "builtin",
						sourceInfo: createSyntheticSourceInfo(`builtin:${builtin.name}`, { source: "builtin" }),
						interactiveOnly: true,
					});
				}

				return success(id, "get_commands", { commands });
			}

			// =================================================================
			// Settings
			// =================================================================

			case "get_settings": {
				const scope = command.scope ?? "effective";
				const settings =
					scope === "global"
						? session.settingsManager.getGlobalSettings()
						: scope === "project"
							? session.settingsManager.getProjectSettings()
							: session.settingsManager.getEffectiveSettings();
				return success(id, "get_settings", { scope, settings });
			}

			case "set_settings": {
				const scope = command.scope ?? "global";
				try {
					if (scope === "project") {
						session.settingsManager.setProjectSettings(command.values);
					} else {
						session.settingsManager.setGlobalSettings(command.values);
					}
					await session.settingsManager.flush();
					return success(id, "set_settings", { scope, values: structuredClone(command.values) });
				} catch (writeError: unknown) {
					return error(
						id,
						"set_settings",
						writeError instanceof Error ? writeError.message : String(writeError),
					);
				}
			}

			case "factory_reset_settings": {
				if (session.isStreaming) {
					return error(id, "factory_reset_settings", "Wait for the current response to finish before resetting settings.");
				}
				if (session.isCompacting) {
					return error(id, "factory_reset_settings", "Wait for compaction to finish before resetting settings.");
				}
				try {
					const agentDir = getAgentDir();
					const settingsPath = join(agentDir, "settings.json");
					const bundledPath = join(getBundledDefaultsDir(), "settings.json");
					if (!existsSync(bundledPath)) {
						return error(id, "factory_reset_settings", `Bundled defaults not found at ${bundledPath}`);
					}
					if (existsSync(settingsPath)) {
						copyFileSync(settingsPath, `${settingsPath}.bak`);
					}
					copyFileSync(bundledPath, settingsPath);
					try {
						chmodSync(settingsPath, 0o600);
					} catch {
						// best-effort
					}
					await session.reload();
					return success(id, "factory_reset_settings");
				} catch (resetError: unknown) {
					return error(
						id,
						"factory_reset_settings",
						resetError instanceof Error ? resetError.message : String(resetError),
					);
				}
			}

			// =================================================================
			// Auth
			// =================================================================

			case "get_auth_providers": {
				const providers = session.modelRuntime
					.getProviders()
					.map((provider) => {
						const authTypes: Array<"oauth" | "api_key"> = [];
						if (provider.auth.oauth) authTypes.push("oauth");
						if (provider.auth.apiKey) authTypes.push("api_key");
						return { providerId: provider.id, name: provider.name, authTypes };
					})
					.sort((a, b) => a.name.localeCompare(b.name));
				return success(id, "get_auth_providers", { providers });
			}

			case "login": {
				const provider = session.modelRuntime.getProvider(command.providerId);
				if (!provider) {
					return error(id, "login", `Unknown provider: ${command.providerId}`);
				}
				if (command.authType === "oauth" && !provider.auth.oauth) {
					return error(id, "login", `Provider ${command.providerId} does not support OAuth login`);
				}
				if (command.authType === "api_key" && !provider.auth.apiKey) {
					return error(id, "login", `Provider ${command.providerId} does not support API key login`);
				}
				try {
					const abortController = new AbortController();
					await session.modelRuntime.login(command.providerId, command.authType, {
						signal: abortController.signal,
						prompt: async (prompt) => {
							if (prompt.signal?.aborted) throw new Error("Login cancelled");
							const id = crypto.randomUUID();
							const result = await new Promise<RpcExtensionUIResponse>((resolve, reject) => {
								const onAbort = () => {
									cleanup();
									resolve({ type: "extension_ui_response", id, cancelled: true });
								};
								const cleanup = () => {
									prompt.signal?.removeEventListener("abort", onAbort);
									pendingExtensionRequests.delete(id);
								};
								prompt.signal?.addEventListener("abort", onAbort, { once: true });
								pendingExtensionRequests.set(id, {
									resolve: (response) => {
										cleanup();
										resolve(response);
									},
									reject: (err) => {
										cleanup();
										reject(err);
									},
								});
								const request: Record<string, unknown> = {
									type: "extension_ui_request",
									id,
									method: prompt.type === "select" ? "select" : "input",
									title: prompt.message,
								};
								if (prompt.type === "select") {
									request.options = prompt.options.map((option) =>
										option.description ? `${option.label} (${option.description})` : option.label,
									);
								} else {
									if (prompt.placeholder) request.placeholder = prompt.placeholder;
									if (prompt.type === "secret") request.inputKind = "secret";
								}
								output(request as RpcExtensionUIRequest);
							});
							if (result.type === "extension_ui_response" && "cancelled" in result && result.cancelled) {
								throw new Error("Login cancelled");
							}
							if ("value" in result) return result.value as string;
							if ("values" in result) return (result.values ? result.values[0] : undefined) as string;
							return undefined as unknown as string;
						},
						notify: (event) => {
							if (event.type === "auth_url") {
								openBrowser(event.url);
								output({
									type: "extension_ui_request",
									id: crypto.randomUUID(),
									method: "notify",
									message: event.instructions
										? `Open in your browser: ${event.url}\n${event.instructions}`
										: `Open in your browser: ${event.url}`,
									notifyType: "info",
								} as RpcExtensionUIRequest);
							} else if (event.type === "device_code") {
								openBrowser(event.verificationUri);
								output({
									type: "extension_ui_request",
									id: crypto.randomUUID(),
									method: "notify",
									message: `Open ${event.verificationUri} and enter code: ${event.userCode}`,
									notifyType: "info",
								} as RpcExtensionUIRequest);
							} else if (event.type === "info") {
								output({
									type: "extension_ui_request",
									id: crypto.randomUUID(),
									method: "notify",
									message: event.message,
									notifyType: "info",
								} as RpcExtensionUIRequest);
							} else if (event.type === "progress") {
								output({
									type: "extension_ui_request",
									id: crypto.randomUUID(),
									method: "notify",
									message: event.message,
									notifyType: "info",
								} as RpcExtensionUIRequest);
							}
						},
					});
					const actionLabel =
						command.authType === "oauth" ? `Logged in to ${provider.name}` : `Saved API key for ${provider.name}`;
					const authType = command.authType;
					const isUnknownModel = session.model?.provider === "unknown" && session.model?.id === "unknown";
					if (isUnknownModel) {
						const available = await session.modelRuntime.getAvailable();
						const providerModels = available.filter((model) => model.provider === command.providerId);
						if (providerModels.length > 0) {
							await session.setModel(providerModels[0]!);
						}
					}
					return success(id, "login", {
						providerId: command.providerId,
						authType,
						message: `${actionLabel}. Credentials saved.`,
					});
				} catch (loginError: unknown) {
					const message = loginError instanceof Error ? loginError.message : String(loginError);
					if (message === "Login cancelled") {
						return error(id, "login", "Login cancelled");
					}
					return error(id, "login", message);
				}
			}

			case "logout": {
				const provider = session.modelRuntime.getProvider(command.providerId);
				if (!provider) {
					return error(id, "logout", `Unknown provider: ${command.providerId}`);
				}
				try {
					await session.modelRuntime.logout(command.providerId);
					return success(id, "logout", { providerId: command.providerId });
				} catch (logoutError: unknown) {
					return error(
						id,
						"logout",
						logoutError instanceof Error ? logoutError.message : String(logoutError),
					);
				}
			}

			case "get_auth_state": {
				try {
					const credentials = await session.modelRuntime.listCredentials();
					const providers = credentials.map(({ providerId, type }) => ({
						providerId,
						authType: type,
						source: "stored",
					}));
					// Environment/configured auth not in the credential store.
					for (const provider of session.modelRuntime.getProviders()) {
						if (providers.some((entry) => entry.providerId === provider.id)) continue;
						const status = session.modelRuntime.getProviderAuthStatus(provider.id);
						if (status.configured) {
							providers.push({
								providerId: provider.id,
								authType: session.modelRuntime.isUsingOAuth(provider.id) ? "oauth" : "api_key",
								source: status.label ?? status.source ?? "environment",
							});
						}
					}
					return success(id, "get_auth_state", { providers });
				} catch (authStateError: unknown) {
					return error(
						id,
						"get_auth_state",
						authStateError instanceof Error ? authStateError.message : String(authStateError),
					);
				}
			}

			// =================================================================
			// Scoped Models
			// =================================================================

			case "get_scoped_models": {
				const enabled = session.settingsManager.getEnabledModels() ?? [];
				const scoped = session.scopedModels.map((entry) => entry.model);
				const models = scoped.length > 0 ? scoped : await session.modelRuntime.getAvailable();
				return success(id, "get_scoped_models", { enabled, models: [...models] });
			}

			case "set_scoped_models": {
				if (command.enabled !== undefined) {
					session.settingsManager.setEnabledModels(command.enabled.length > 0 ? command.enabled : undefined);
				}
				const enabled = session.settingsManager.getEnabledModels() ?? [];
				if (command.reorder !== undefined && command.reorder.length > 0) {
					const patternSet = new Set(command.reorder);
					const kept = enabled.filter((pattern) => patternSet.has(pattern));
					const added = command.reorder.filter((pattern) => !kept.includes(pattern));
					session.settingsManager.setEnabledModels([...kept, ...added]);
				}
				await session.settingsManager.flush();
				return success(id, "set_scoped_models", { enabled: session.settingsManager.getEnabledModels() ?? [] });
			}

			// =================================================================
			// Session Import
			// =================================================================

			case "import_jsonl": {
				try {
					await runtimeHost.importFromJsonl(command.path);
					await rebindSession();
					const sessionFile = session.sessionFile;
					return success(id, "import_jsonl", { sessionPath: sessionFile ?? command.path });
				} catch (importError: unknown) {
					return error(
						id,
						"import_jsonl",
						importError instanceof Error ? importError.message : String(importError),
					);
				}
			}

			// =================================================================
			// Git helper
			// =================================================================

			case "git": {
				const prompt = buildGitCommandPrompt(command.command);
				let gitPreflightSucceeded = false;
				void session
					.prompt(prompt, {
						streamingBehavior: "steer",
						source: "rpc",
						preflightResult: (didSucceed) => {
							if (didSucceed) {
								gitPreflightSucceeded = true;
								output(success(id, "git"));
							}
						},
					})
					.catch((e) => {
						if (!gitPreflightSucceeded) {
							output(error(id, "git", e.message));
						}
					});
				return undefined;
			}

			// =================================================================
			// Reload
			// =================================================================

			case "reload": {
				if (session.isStreaming) {
					return error(id, "reload", "Wait for the current response to finish before reloading.");
				}
				if (session.isCompacting) {
					return error(id, "reload", "Wait for compaction to finish before reloading.");
				}
				try {
					await session.reload();
					return success(id, "reload");
				} catch (reloadError: unknown) {
					return error(
						id,
						"reload",
						reloadError instanceof Error ? reloadError.message : String(reloadError),
					);
				}
			}

			// =================================================================
			// Tree ops
			// =================================================================

			case "set_entry_label": {
				try {
					const labelId = session.sessionManager.appendLabelChange(command.entryId, command.label);
					return success(id, "set_entry_label", { labelId });
				} catch (labelError: unknown) {
					return error(
						id,
						"set_entry_label",
						labelError instanceof Error ? labelError.message : String(labelError),
					);
				}
			}

			// =================================================================
			// Trust
			// =================================================================

			case "get_trust": {
				const cwd = session.sessionManager.getCwd();
				const trustStore = new ProjectTrustStore(runtimeHost.services.agentDir);
				const entry = trustStore.getEntry(cwd);
				return success(id, "get_trust", {
					cwd,
					savedDecision: entry ? { path: entry.path, decision: entry.decision } : null,
					projectTrusted: session.settingsManager.isProjectTrusted(),
					trustRequired: hasTrustRequiringProjectResources(cwd),
				});
			}

			case "set_trust": {
				const cwd = session.sessionManager.getCwd();
				const trustStore = new ProjectTrustStore(runtimeHost.services.agentDir);
				try {
					if (command.decision === null) {
						trustStore.set(cwd, null);
					} else {
						trustStore.set(cwd, command.decision);
					}
					return success(id, "set_trust", { decision: command.decision, restartRequired: command.decision !== null });
				} catch (trustError: unknown) {
					return error(
						id,
						"set_trust",
						trustError instanceof Error ? trustError.message : String(trustError),
					);
				}
			}

			// =================================================================
			// Hotkeys / version / share
			// =================================================================

			case "get_hotkeys": {
				const keybindings = KeybindingsManager.create();
				const hotkeys = keybindings.getEffectiveConfig();
				return success(id, "get_hotkeys", { hotkeys });
			}

			case "get_available_themes": {
				// Mirror TUI startup: register extension/package themes before listing.
				setRegisteredThemes(session.resourceLoader.getThemes().themes);
				const themes = getAvailableThemesWithPaths().map(({ name, path }) => ({ name, path }));
				const currentSetting = session.settingsManager.getThemeSetting();
				const current = currentSetting?.includes("/") ? undefined : currentSetting;
				return success(id, "get_available_themes", { themes, current });
			}

			case "get_version_info": {
				const changelog = parseChangelog(getChangelogPath());
				return success(id, "get_version_info", { version: VERSION, changelog });
			}

			case "share_gist": {
				try {
					const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
					if (authResult.status !== 0) {
						return error(
							id,
							"share_gist",
							"GitHub CLI is not logged in. Run 'gh auth login' first.",
						);
					}
					const tmpFile = join(tmpdir(), `selesai-session-${crypto.randomUUID()}.html`);
					await session.exportToHtml(tmpFile, { themeName: command.themeName });
					const result = spawnSync(
						"gh",
						["gist", "create", "--public=false", tmpFile],
						{ encoding: "utf-8" },
					);
					try {
						unlinkSync(tmpFile);
					} catch {
						// best-effort cleanup
					}
					if (result.status !== 0) {
						return error(id, "share_gist", (result.stderr ?? "Unknown error").trim() || "Failed to create gist");
					}
					const gistUrl = (result.stdout ?? "").trim();
					const gistId = gistUrl.split("/").pop();
					if (!gistId) {
						return error(id, "share_gist", "Failed to parse gist ID from gh output");
					}
					const previewUrl = getShareViewerUrl(gistId);
					return success(id, "share_gist", { url: previewUrl, gistUrl });
				} catch (shareError: unknown) {
					return error(id, "share_gist", shareError instanceof Error ? shareError.message : String(shareError));
				}
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	let detachInput = () => {};

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;
		await shutdown();
	}

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(
				error(
					undefined,
					"parse",
					`Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
				),
			);
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "extension_ui_response"
		) {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			return;
		}

		const command = parsed as RpcCommand;
		try {
			const response = await handleCommand(command);
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			output(
				error(
					command.id,
					command.type,
					commandError instanceof Error ? commandError.message : String(commandError),
				),
			);
			await waitForRawStdoutBackpressure();
		}
	};

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
			void handleInputLine(line);
		});
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
