# Research: Agent Skills / Pi-Selesai skill discovery vs. system-prompt exposure

## Summary

I cannot locate the **official Agent Skills specification** or the **Pi-Selesai implementation** in public code or documentation (grep.app returned no matches; web searches returned no usable evidence). The terms appear to belong to a private/custom stack. Below is a **principled comparison** of the three requested approaches, with conservative recommendations and explicit gaps where concrete CLI/config paths cannot be attested.

The core tension is: the system prompt advertises skills to the model; the dispatch layer registers them for execution. Reducing system-prompt exposure means **decoupling advertisement from registration**.

## Findings

1. **Option (1): `--no-skills` — discovery completely off**
   - **Effect:** No skill metadata enters the model context. Manual/hard-coded commands can still work if the runtime dispatches them outside the LLM loop, but the model cannot autonomously invoke any skill.
   - **Pros:** Maximum context reduction, predictable behavior, no accidental autonomous skill calls.
   - **Cons:** Fully agentic workflows break; any skill use must be driven by explicit user commands or deterministic code paths.
   - **Configuration guidance (provisional):** pass `--no-skills` at CLI startup, or set `agent.skills.enabled: false` / `agent.skills.discovery: false` in config. *These exact key names could not be verified from public sources.*

2. **Option (2): per-skill `disable-model-invocation` / manual-only**
   - **Effect:** The skill remains registered in the dispatch layer (so it can be invoked by explicit user commands or by the application), but the model is not told it exists.
   - **Pros:** Fine-grained control; keeps skills available for manual use without bloating the system prompt or exposing risky autonomous capabilities.
   - **Cons:** Requires a first-class distinction between *registration* and *advertisement* in the framework; misconfiguration can still leak metadata if the same descriptor is used for both.
   - **Configuration guidance (provisional):** set per-skill flags such as `model_invocation: false`, `auto_invokable: false`, `manual_only: true`, or `allowed_model_modes: []`. The skill should still appear in the manual command registry.

3. **Option (3): stripping skill metadata while retaining manual commands**
   - **Effect:** Names/descriptions/signatures are removed or minimized before the prompt is built, but the command ID is still bound to the runtime.
   - **Pros:** Can be done ad-hoc when the framework does not support option 2.
   - **Cons:** **Riskiest.** Removing metadata can confuse routing/debugging, make commands hard to document, and cause inconsistent behavior if the model somehow still infers the skill from tool names. It is a workaround, not a supported mode.
   - **Severity:** medium-to-high. If you strip too much, manual users lose discoverability; strip too little and the model still sees it.

4. **General recommendation**
   - **Preferred:** Option 2 if the goal is selective exposure; Option 1 if the goal is zero autonomous skill use.
   - **Avoid:** Option 3 as a primary strategy; reserve it for compatibility patches until the framework supports explicit advertisement control.
   - **Rationale:** The cleanest design is to advertise only what the model should autonomously use, while keeping the full registry available to the command dispatcher.

## Sources

- No public sources were found for the exact spec or Pi-Selesai docs.  
- Findings are derived from general agent-framework design patterns and are therefore **provisional** until internal documentation/repo can be reviewed.

## Gaps

- **Missing concrete spec:** The official Agent Skills spec, Selesai/Pi source code, or CLI docs were not indexed publicly.
- **Missing exact config keys:** `--no-skills`, `disable-model-invocation`, `manual-only`, and metadata-stripping mechanisms are described conceptually; exact key names and file locations cannot be attested.
- **Next step:** Provide access to the private repo/docs (e.g., `selesai` monorepo, `pi` agent package, or internal spec) so I can verify exact CLI flags, YAML/TOML keys, and system-prompt assembly code paths.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "partially-satisfied",
      "evidence": "Compared the three requested approaches conceptually and identified provisional configuration patterns. No concrete file paths could be verified because the Agent Skills / Pi-Selesai spec and implementation are not publicly indexed."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "grep.app and web research returned no matches for the official Agent Skills spec, --no-skills flag, or Selesai/Pi implementation docs."
  ],
  "residualRisks": [
    "Cannot verify exact CLI flags, config keys, or system-prompt assembly paths without access to the private repo/spec.",
    "Option 3 (metadata stripping) is a workaround; without exact implementation details it may degrade manual usability or leak skill names through tool identifiers.",
    "Recommendation is design-principle based rather than implementation-verified."
  ],
  "noStagedFiles": true,
  "diffSummary": "No files changed; research-only output.",
  "reviewFindings": [
    "blocker: research-0001 - No public evidence found for the official Agent Skills spec or Pi-Selesai skill system; all CLI/config guidance is provisional.",
    "note: research-0002 - A private repo/spec review is needed to map the conceptual options to concrete flags and system-prompt code paths."
  ],
  "manualNotes": "The user is asking about a likely private/custom stack. To finish this research properly, access to the Selesai/Pi source or internal Agent Skills documentation is required. I have structured the answer as a conservative best-practice comparison with clear uncertainty gaps."
}
```

⧉ copy assistant: /cp 4e23ee