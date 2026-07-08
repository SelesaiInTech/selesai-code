// ponytail: Plan 4 — semantic gates. One marker substring check per critical
// artifact. No JSON, no schema framework — the smallest machine-readable
// contract that stops an empty/wrong file from silently advancing a phase.
// Each validator returns {ok:false,reason} so the adapter can surface the
// exact problem to the model instead of a generic "blocked".

export type WorkflowArtifactValidator = (
  content: string,
) => { ok: true } | { ok: false; reason: string };

// ponytail: shared marker factory. First occurrence wins; case-insensitive on
// the status word; trailing whitespace allowed. Returns ok:false (not throw)
// when the marker is absent so the workflow blocks cleanly instead of crashing.
function markerValidator(marker: string, statusWord: string): WorkflowArtifactValidator {
  const re = new RegExp(
    `${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*${statusWord}\\b`,
    "i",
  );
  return (content) => {
    if (re.test(content)) return { ok: true };
    return {
      ok: false,
      reason: `missing required marker \`${marker}: ${statusWord}\` on its own line`,
    };
  };
}

export const planValidator = markerValidator("WORKFLOW_PLAN_STATUS", "ready");
export const handoffValidator = markerValidator("WORKFLOW_HANDOFF_STATUS", "ready");
// ponytail: loop-complete.md is engine-written (adapter.ts) with this marker,
// but a parent/agent-written file must still carry it to advance.
export const loopCompleteValidator = markerValidator("WORKFLOW_LOOP_STATUS", "clean");
export const reviewValidator = markerValidator("WORKFLOW_REVIEW_STATUS", "clean");

// ponytail: one source of truth for the marker strings so prompts and the
// engine-written loop-complete.md stay in sync with the validators.
export const MARKERS = {
  plan: "WORKFLOW_PLAN_STATUS: ready",
  handoff: "WORKFLOW_HANDOFF_STATUS: ready",
  loopComplete: "WORKFLOW_LOOP_STATUS: clean",
  review: "WORKFLOW_REVIEW_STATUS: clean",
} as const;