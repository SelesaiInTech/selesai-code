# Research: Reducing skill prompt tokens while preserving safety/manual usability

## Summary

The codebase supports two token-reduction mechanisms for skills, not three:
- **`disable-model-invocation: true`** (per-skill frontmatter) hides only that skill’s description from the system prompt while keeping the skill loaded and usable via `/skill:name`.
- **`--no-skills`** disables skill *discovery*, so no discovered skills appear in the system prompt or register `/skill:name` commands. However, explicit `--skill <path>` paths still load and therefore still register commands.

“Prompt stripping” is not implemented as a first-class feature in the inspected files. The only stripping present is `stripFrontmatter()` used when expanding a `/skill:name` command to inject the skill body into a user message.

## Findings

1. **`disable-model-invocation` preserves `/skill:name` and hides the skill from the model context.**
   - `docs/skills.md` frontmatter table: `disable-model-invocation` “When `true`, skill is hidden from system prompt. Users must use `/skill:name`.” [docs/skills.md]
   - The system prompt only appends skills when `hasRead && skills.length > 0` (`src/core/system-prompt.ts:170-175` and `:117-121`). A skill with `disable-model-invocation` remains in the loaded skill list but is excluded from `formatSkillsForPrompt`, so its description tokens are saved while the skill file itself stays available for `/skill:name` expansion.

2. **`/skill:name` expansion reads the skill file directly, independent of system-prompt inclusion.**
   - `AgentSession._expandSkillCommand()` (`src/core/agent-session.ts:1100-1124`) matches `/skill:name`, looks up the loaded skill by name, and embeds the full `SKILL.md` body (minus frontmatter) into the user message. This path does not depend on the skill having been in the system prompt.

3. **`--no-skills` does not remove *all* skill commands.**
   - `docs/skills.md` Locations section: “Disable discovery with `--no-skills` (explicit `--skill` paths still load).”
   - `src/core/resource-loader.ts:374-376`: when `noSkills` is true, skill paths are still built from `cliEnabledSkills` plus `additionalSkillPaths`. Only auto-discovered skills are skipped.
   - Therefore any skill passed via `--skill <path>` is still loaded and still registers `/skill:name`.

4. **No evidence of a separate “prompt stripping” facility.**
   - Searches for `strip` outside of `stripFrontmatter` found only frontmatter removal during `/skill:name` expansion. There is no configuration that strips skill content from prompts while leaving skills loaded.

5. **Required CLI file was missing.**
   - `cli/args.ts` returned `ENOENT`; its `--no-skills` parsing could not be verified from the local tree.

## Sources

- Kept: `docs/skills.md` — defines `disable-model-invocation`, `--no-skills` discovery behavior, and `/skill:name` commands.
- Kept: `src/core/system-prompt.ts:117-121,170-175` — skills appended to prompt only when read tool available and skills loaded.
- Kept: `src/core/agent-session.ts:1100-1124` — `/skill:name` expansion reads skill file directly.
- Kept: `src/core/resource-loader.ts:374-376` — `noSkills` still loads CLI/explicit skill paths.

## Gaps

- Official `agentskills.io` documentation for `disable-model-invocation` could not be retrieved via the available search tools; all claims about the official spec rely on the local `docs/skills.md` reference to it.
- `cli/args.ts` was absent, so the exact CLI flag wiring is unverified from source.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings with paths: docs/skills.md defines disable-model-invocation and --no-skills behavior; src/core/system-prompt.ts:117-121,170-175 shows skills appended conditionally; src/core/agent-session.ts:1100-1124 shows /skill:name expansion reads skill files directly; src/core/resource-loader.ts:374-376 shows --no-skills still loads explicit --skill paths."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Reviewed local docs/skills.md, src/core/system-prompt.ts, src/core/agent-session.ts, src/core/resource-loader.ts.",
    "cli/args.ts was not present (ENOENT).",
    "Web research for official agentskills.io docs returned no usable evidence."
  ],
  "residualRisks": [
    "Official Agent Skills specification URL could not be verified; reliance is on local docs/skills.md's citation.",
    "Missing cli/args.ts means the exact CLI argument parsing and precedence for --no-skills vs --skill is not directly attested from source."
  ],
  "noStagedFiles": true,
  "diffSummary": "No edits performed; research-only brief.",
  "reviewFindings": [
    "finding: docs/skills.md — disable-model-invocation:true hides skill from system prompt but preserves /skill:name usage.",
    "finding: docs/skills.md + src/core/resource-loader.ts:374-376 — --no-skills disables discovery, but explicit --skill paths still load and register commands, so it does NOT remove all skill commands.",
    "finding: src/core/agent-session.ts:1100-1124 — /skill:name expansion is independent of whether the skill was included in the system prompt.",
    "blocker: none"
  ],
  "manualNotes": "Prompt stripping is not a separate implemented mechanism in this codebase; the closest behavior is stripFrontmatter during /skill:name expansion. For maximum token savings while keeping manual access, per-skill disable-model-invocation is safer than --no-skills because it keeps the skill usable by name without its description consuming prompt tokens."
}
```

⧉ copy assistant: /cp 24d29f