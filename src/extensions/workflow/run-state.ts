import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { withFileMutationQueue } from "@selesai/code";

import type { Phase } from "./state-machine.ts";

export const WORKFLOW_STATE_FILENAME = "workflow.json";

export interface LoopState {
  reviewRound: number;
  maxIterations: number;
  stage: "building" | "reviewing" | "clean" | "maxed";
  reviewPath?: string;
}

export interface PersistedWorkflowRun {
  version: 1;
  id: string;
  mode: string;
  status: "active" | "completed";
  goal: string;
  artifactDir: string;
  phase: Phase;
  autoArmed: boolean;
  loopState?: LoopState;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowModes = Record<string, readonly Phase[]>;
export interface ListedWorkflowRun { statePath: string; run: PersistedWorkflowRun }

function isInside(base: string, path: string): boolean {
  const rel = relative(resolve(base), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${process.platform === "win32" ? "\\" : "/"}`));
}

function invalid(message: string): never {
  throw new Error(`Invalid ${WORKFLOW_STATE_FILENAME}: ${message}`);
}

function validateLoopState(value: unknown): LoopState | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") invalid("loopState must be an object");
  const loop = value as Record<string, unknown>;
  if (!Number.isInteger(loop.reviewRound) || (loop.reviewRound as number) < 0) invalid("loopState.reviewRound must be a non-negative integer");
  if (!Number.isInteger(loop.maxIterations) || (loop.maxIterations as number) < 1) invalid("loopState.maxIterations must be a positive integer");
  if (!(["building", "reviewing", "clean", "maxed"] as string[]).includes(loop.stage as string)) invalid("loopState.stage is invalid");
  if (loop.reviewPath !== undefined && (typeof loop.reviewPath !== "string" || !/^loop-review-\d+\.md$/.test(loop.reviewPath))) invalid("loopState.reviewPath is invalid");
  return loop as unknown as LoopState;
}

export function validateWorkflowRun(value: unknown, statePath: string, modes: WorkflowModes): PersistedWorkflowRun {
  if (!value || typeof value !== "object") invalid("record must be an object");
  const run = value as Record<string, unknown>;
  if (run.version !== 1) invalid("unsupported version");
  if (typeof run.id !== "string" || !run.id || run.id !== basename(dirname(resolve(statePath)))) invalid("id must match its containing directory");
  if (typeof run.mode !== "string" || !modes[run.mode]) invalid("unknown mode");
  if (run.status !== "active" && run.status !== "completed") invalid("status is invalid");
  if (typeof run.goal !== "string") invalid("goal must be a string");
  if (typeof run.artifactDir !== "string" || resolve(run.artifactDir) !== dirname(resolve(statePath))) invalid("artifactDir does not match its containing directory");
  if (typeof run.phase !== "string" || !modes[run.mode].includes(run.phase)) invalid("phase is not valid for the selected mode");
  if (typeof run.autoArmed !== "boolean") invalid("autoArmed must be boolean");
  if (typeof run.createdAt !== "string" || typeof run.updatedAt !== "string") invalid("timestamps must be strings");
  validateLoopState(run.loopState);
  return run as unknown as PersistedWorkflowRun;
}

export async function loadWorkflowRun(statePath: string, modes: WorkflowModes): Promise<PersistedWorkflowRun> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${statePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateWorkflowRun(parsed, statePath, modes);
}

export async function saveWorkflowRun(run: PersistedWorkflowRun): Promise<void> {
  const statePath = resolve(run.artifactDir, WORKFLOW_STATE_FILENAME);
  await withFileMutationQueue(statePath, async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    await rename(tempPath, statePath);
  });
}

export async function listResumableWorkflowRuns(base: string, modes: WorkflowModes): Promise<ListedWorkflowRun[]> {
  let entries;
  try {
    entries = await readdir(resolve(base), { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const listed: ListedWorkflowRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statePath = resolve(base, entry.name, WORKFLOW_STATE_FILENAME);
    try {
      const run = await loadWorkflowRun(statePath, modes);
      if (run.status === "active") listed.push({ statePath, run });
    } catch {
      // A corrupt or unrelated artifact is not a resumable run.
    }
  }
  return listed.sort((a, b) => b.run.updatedAt.localeCompare(a.run.updatedAt));
}

export async function resolveWorkflowRun(selector: string, base: string, modes: WorkflowModes): Promise<ListedWorkflowRun> {
  const root = resolve(base);
  const candidate = resolve(root, selector);
  if (selector.includes("/") || selector.includes("\\") || selector.endsWith(".json") || selector.startsWith(".")) {
    if (!isInside(root, candidate)) throw new Error("Workflow run path must be inside the artifacts directory.");
    const statePath = candidate.endsWith(WORKFLOW_STATE_FILENAME) ? candidate : resolve(candidate, WORKFLOW_STATE_FILENAME);
    const run = await loadWorkflowRun(statePath, modes);
    return { statePath, run };
  }
  const runs = await listResumableWorkflowRuns(root, modes);
  const found = runs.find(({ run }) => run.id === selector);
  if (!found) throw new Error(`No resumable workflow run with id ${selector}.`);
  return found;
}
