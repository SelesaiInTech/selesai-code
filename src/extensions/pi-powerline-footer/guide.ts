import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type GuideMode = "full" | "compact" | "off";
export type GuideDisplayMode = "full" | "compact" | "none";

export interface GuideFeature {
  id: string;
  section?: string;
  title: string;
  example: string;
  introducedIn: string;
}

export interface GuidePreferences {
  mode: GuideMode;
  lastSeenVersion?: string;
}

export interface GuidePreferencesUpdate {
  mode?: GuideMode;
  lastSeenVersion?: string | null;
}

// Keep this map useful, not exhaustive: each row points at a real command, shortcut,
// or prompt from the root README without reproducing the README in the overlay.
export const GUIDE_FEATURES: readonly GuideFeature[] = [
  {
    id: "workflow",
    section: "Start here",
    title: "Workflow",
    example: '"Use $workflow to orchestrate this implementation."',
    introducedIn: "0.9.14",
  },
  {
    id: "settings",
    section: "Start here",
    title: "Settings",
    example: "/settings · /guide compact|off|reset · /reload",
    introducedIn: "0.5.13",
  },
  {
    id: "subagents",
    section: "Delegate / research",
    title: "Plan",
    example: '"Ask the architect to challenge this plan..."',
    introducedIn: "0.5.13",
  },
  {
    id: "parallel-review",
    section: "Delegate / research",
    title: "Review",
    example: '"Run parallel commentator agents for correctness..."',
    introducedIn: "0.5.13",
  },
  {
    id: "web-research",
    section: "Delegate / research",
    title: "Research",
    example: '"Ask the researcher to research <topic> and cite sources."',
    introducedIn: "0.5.13",
  },
  {
    id: "skills",
    section: "Delegate / research",
    title: "Skills",
    example: "/skill:*",
    introducedIn: "0.5.13",
  },
  {
    id: "recovery",
    section: "Recover",
    title: "Recover",
    example: "/undo · /tree · /fork · /cp <hash>",
    introducedIn: "0.5.13",
  },
  {
    id: "handoff",
    section: "Recover",
    title: "Handoff",
    example: "/handoff-new Next: fix <problem>; start with a coding plan.",
    introducedIn: "0.5.13",
  },
];

export const GUIDE_DISMISS_HINT = "Press any key to continue";

export const GUIDE_COMPACT_LINES = [
  "/guide full · /settings",
  '"Use $workflow to orchestrate this implementation."',
  '"Ask the researcher to research <topic>."',
  "/skill:* · /undo · /handoff-new <next focus>",
] as const;

export type GuideLine =
  | { kind: "section"; text: string }
  | { kind: "feature"; feature: GuideFeature };

export function getGuideFeatureLines(features: readonly GuideFeature[] = GUIDE_FEATURES): GuideLine[] {
  return features.flatMap((feature, index) => {
    const previous = features[index - 1];
    const section = feature.section && feature.section !== previous?.section
      ? [{ kind: "section" as const, text: feature.section }]
      : [];
    return [...section, { kind: "feature" as const, feature }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGuideMode(value: unknown): value is GuideMode {
  return value === "full" || value === "compact" || value === "off";
}

function versionParts(version: string): [number, number, number] {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

export function compareGuideVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let i = 0; i < leftParts.length; i++) {
    if (leftParts[i] !== rightParts[i]) return leftParts[i] - rightParts[i];
  }
  return 0;
}

export function getGuidePreferences(settings: unknown): GuidePreferences {
  const raw = isRecord(settings) && isRecord(settings.selesaiGuide)
    ? settings.selesaiGuide
    : {};

  return {
    mode: isGuideMode(raw.mode) ? raw.mode : "compact",
    lastSeenVersion: typeof raw.lastSeenVersion === "string" ? raw.lastSeenVersion : undefined,
  };
}

export function getNewGuideFeatures(
  lastSeenVersion: string | undefined,
  currentVersion: string,
  features: readonly GuideFeature[] = GUIDE_FEATURES,
): GuideFeature[] {
  if (!lastSeenVersion || compareGuideVersions(lastSeenVersion, currentVersion) >= 0) {
    return [];
  }

  return features.filter((feature) => (
    compareGuideVersions(feature.introducedIn, lastSeenVersion) > 0
    && compareGuideVersions(feature.introducedIn, currentVersion) <= 0
  ));
}

export function resolveGuideDisplayMode(options: {
  reason: string;
  hasUI: boolean;
  guideMode: GuideMode;
}): GuideDisplayMode {
  if (!options.hasUI || options.reason === "reload" || options.guideMode === "off") {
    return "none";
  }

  return options.guideMode === "compact" ? "compact" : "full";
}

function readSettingsFile(settingsPath: string): Record<string, unknown> | null {
  if (!existsSync(settingsPath)) return {};

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveGuidePreferences(
  update: GuidePreferencesUpdate,
  settingsPath: string,
): boolean {
  const settings = readSettingsFile(settingsPath);
  if (!settings) return false;

  const current = getGuidePreferences(settings);
  const raw = isRecord(settings) && isRecord(settings.selesaiGuide)
    ? settings.selesaiGuide
    : {};
  const next: Record<string, unknown> = {};
  if (update.mode !== undefined) {
    next.mode = update.mode;
  } else if (typeof raw.mode === "string") {
    // Version-only writes (markGuideVersionSeen) must preserve an explicit user
    // mode but never persist the fallback default as a user choice.
    next.mode = raw.mode;
  }
  const lastSeenVersion = update.lastSeenVersion === null
    ? undefined
    : update.lastSeenVersion ?? current.lastSeenVersion;
  if (lastSeenVersion) next.lastSeenVersion = lastSeenVersion;

  settings.selesaiGuide = next;

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function markGuideVersionSeen(
  version: string,
  settingsPath: string,
): boolean {
  return saveGuidePreferences({ lastSeenVersion: version }, settingsPath);
}
