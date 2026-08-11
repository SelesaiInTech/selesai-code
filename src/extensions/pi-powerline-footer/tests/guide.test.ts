import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GUIDE_COMPACT_LINES,
  GUIDE_DISMISS_HINT,
  GUIDE_FEATURES,
  getGuideFeatureLines,
  getGuidePreferences,
  getNewGuideFeatures,
  resolveGuideDisplayMode,
  saveGuidePreferences,
  type GuideFeature,
} from "../guide.ts";

const features: GuideFeature[] = [
  { id: "old", title: "Old", example: "/old", introducedIn: "0.5.0" },
  { id: "new", title: "New", example: "/new", introducedIn: "0.5.3" },
  { id: "future", title: "Future", example: "/future", introducedIn: "0.6.0" },
];


test("explicit full guide opens for each real session start", () => {
  for (const reason of ["startup", "new", "resume", "fork"]) {
    assert.equal(resolveGuideDisplayMode({ reason, hasUI: true, guideMode: "full" }), "full");
  }
});

test("guide dismissal and compact preferences change automatic display", () => {
  assert.equal(resolveGuideDisplayMode({ reason: "startup", hasUI: true, guideMode: "compact" }), "compact");
  assert.equal(resolveGuideDisplayMode({ reason: "startup", hasUI: true, guideMode: "off" }), "none");
  assert.equal(resolveGuideDisplayMode({ reason: "reload", hasUI: true, guideMode: "full" }), "none");
  assert.equal(resolveGuideDisplayMode({ reason: "startup", hasUI: false, guideMode: "full" }), "none");
});

test("guide defaults to a compact header so fixed-editor mode stays active", () => {
  const preferences = getGuidePreferences({});
  assert.equal(preferences.mode, "compact");
  assert.equal(resolveGuideDisplayMode({ reason: "startup", hasUI: true, guideMode: preferences.mode }), "compact");
});

test("full and compact guide content expose README commands and examples", () => {
  const full = getGuideFeatureLines()
    .map((line) => line.kind === "section" ? line.text : `${line.feature.title}: ${line.feature.example}`)
    .join("\n");
  const compact = GUIDE_COMPACT_LINES.join("\n");

  assert.match(full, /\/settings/);
  assert.match(full, /\/workflow-task/);
  assert.match(full, /\/workflow-prototype/);
  assert.match(full, /Ask the architect to challenge this plan/);
  assert.match(full, /Ask the researcher to research <topic> and cite sources/);
  assert.match(full, /\/skill:\*/);
  assert.match(full, /\/handoff-new Next: fix <problem>; start with a coding plan/);
  assert.doesNotMatch(full, /question\(|\/intercom|powerline/);
  assert.match(compact, /\/settings/);
  assert.match(compact, /\/workflow-task/);
  assert.match(compact, /Ask the researcher to research <topic>/);
});

test("blocking guide dismisses only from its overlay input handler", () => {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");

  assert.equal(GUIDE_DISMISS_HINT, "Press any key to continue");
  assert.match(source, /guideOverlayBlocking = true;[\s\S]*handleInput: \(\) => dismiss\(\),/);
  // The blocking guide cannot be dismissed by the welcome scheduler: dismissWelcome
  // bails while guideOverlayBlocking is set, so only the overlay's input handler
  // (which clears the flag first) can close it.
  assert.match(source, /function dismissWelcome\(ctx: any\) \{[\s\S]*?if \(guideOverlayBlocking\) return;/);
});

test("README-derived guide entries stay in the feature map", () => {
  assert.deepEqual(
    GUIDE_FEATURES.filter((feature) => feature.id === "settings" || feature.id === "handoff").map((feature) => feature.example),
    ["/settings · /guide compact|off|reset · /reload", "/handoff-new Next: fix <problem>; start with a coding plan."],
  );
});

test("new feature detection is version bounded and empty on first install", () => {
  assert.deepEqual(getNewGuideFeatures(undefined, "0.5.3", features), []);
  assert.deepEqual(getNewGuideFeatures("0.5.0", "0.5.3", features).map((feature) => feature.id), ["new"]);
  assert.deepEqual(getNewGuideFeatures("0.5.3", "0.5.3", features), []);
  assert.deepEqual(getNewGuideFeatures("0.5.0", "0.5.2", features), []);
});

test("guide dismissal persists only the mode and version marker", () => {
  const dir = mkdtempSync(join(tmpdir(), "selesai-guide-"));
  const settingsPath = join(dir, "settings.json");

  try {
    assert.equal(saveGuidePreferences({ mode: "off", lastSeenVersion: "0.5.3" }, settingsPath), true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(settings.selesaiGuide, { mode: "off", lastSeenVersion: "0.5.3" });
    assert.equal(getGuidePreferences(settings).mode, "off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid persisted guide settings fall back to the compact guide", () => {
  assert.deepEqual(getGuidePreferences({ selesaiGuide: { mode: "unexpected", lastSeenVersion: 42 } }), {
    mode: "compact",
    lastSeenVersion: undefined,
  });
});
