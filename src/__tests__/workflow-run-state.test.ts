import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  WORKFLOW_STATE_FILENAME,
  listResumableWorkflowRuns,
  loadWorkflowRun,
  saveWorkflowRun,
  type PersistedWorkflowRun,
} from "../extensions/workflow/run-state.ts";

const modes = { prototype: ["grilling", "audit"] };
let tmp = "";
afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

function run(id = "one", status: "active" | "completed" = "active"): PersistedWorkflowRun {
  const artifactDir = join(tmp, id);
  return {
    version: 1, id, mode: "prototype", status, goal: "test", artifactDir,
    phase: "grilling", autoArmed: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: `2026-01-01T00:00:0${id === "two" ? "2" : "1"}.000Z`,
  };
}

describe("workflow run state", () => {
  it("round-trips atomically and lists only active runs newest first", async () => {
    tmp = mkdtempSync(join(tmpdir(), "workflow-state-"));
    await saveWorkflowRun(run("one"));
    await saveWorkflowRun(run("two"));
    await saveWorkflowRun(run("done", "completed"));
    expect(await loadWorkflowRun(join(tmp, "one", WORKFLOW_STATE_FILENAME), modes)).toEqual(run("one"));
    expect(JSON.parse(readFileSync(join(tmp, "one", WORKFLOW_STATE_FILENAME), "utf8")).id).toBe("one");
    expect((await listResumableWorkflowRuns(tmp, modes)).map(({ run }) => run.id)).toEqual(["two", "one"]);
  });

  it("rejects malformed and old state without making it resumable", async () => {
    tmp = mkdtempSync(join(tmpdir(), "workflow-state-"));
    const statePath = join(tmp, "bad", WORKFLOW_STATE_FILENAME);
    mkdirSync(join(tmp, "bad"));
    writeFileSync(statePath, "{ bad json");
    await expect(loadWorkflowRun(statePath, modes)).rejects.toThrow(/Cannot read/);
    const old = { ...run("old"), version: 0 };
    await saveWorkflowRun({ ...old, version: 1 });
    writeFileSync(join(tmp, "old", WORKFLOW_STATE_FILENAME), JSON.stringify(old));
    await expect(loadWorkflowRun(join(tmp, "old", WORKFLOW_STATE_FILENAME), modes)).rejects.toThrow(/unsupported version/);
  });

  it("rejects state whose id or saved review path cannot belong to its artifact directory", async () => {
    tmp = mkdtempSync(join(tmpdir(), "workflow-state-"));
    await saveWorkflowRun(run("one"));
    const statePath = join(tmp, "one", WORKFLOW_STATE_FILENAME);
    writeFileSync(statePath, JSON.stringify({ ...run("one"), id: "other" }));
    await expect(loadWorkflowRun(statePath, modes)).rejects.toThrow(/id must match/);
    writeFileSync(statePath, JSON.stringify({ ...run("one"), loopState: { reviewRound: 1, maxIterations: 3, stage: "building", reviewPath: "../outside.md" } }));
    await expect(loadWorkflowRun(statePath, modes)).rejects.toThrow(/reviewPath is invalid/);
  });
});
