## Findings

1. **Main CLI extension discovery/loading**
   - `src/main.ts:620-681` loads bundled extensions from `getBundledExtensionsDir()` through `additionalExtensionPaths`, then adds CLI `--extension` paths.
   - `src/config.ts:527-530` resolves that bundled directory to `src/extensions` in this source checkout (or `dist/extensions` in the packaged CLI).
   - `src/core/resource-loader.ts:388-447` combines those additional paths with discovered extensions unless `--no-extensions` is set.
   - `src/core/package-manager.ts:2389-2524` discovers:
     - trusted project extensions under `<project-config-dir>/extensions`;
     - user extensions under `~/.selesai/agent/extensions`;
     - compatible host Pi extensions under `~/.pi/agent/extensions`;
     - settings-declared extension sources.

2. **Architect child path/config**
   - `src/extensions/pi-subagents/agents/architect.md` defines `architect` with read-only tools and **no `extensions` allowlist**.
   - `src/extensions/pi-subagents/src/runs/foreground/execution.ts:181-218,291-297` builds child args and launches `selesai` with `cwd: options.cwd ?? runtimeCwd` and `env: { ...process.env, ...sharedEnv, ... }`.
   - `src/extensions/pi-subagents/src/runs/shared/pi-spawn.ts:125-146` resolves the normal child command to `selesai` (unless explicitly overridden).
   - `src/extensions/pi-subagents/src/runs/shared/pi-args.ts:135-154` adds only the prompt runtime extension for architect; it adds `--no-extensions` **only when** `agent.extensions` is explicitly configured. Architect has none, so its child uses normal CLI extension discovery.
   - Since the child inherits `SELESAI_CODING_AGENT_DIR` and runs from the same effective cwd, it gets the same user config dir and project extension-discovery path as the parent.

3. **Conclusion**
   - **Yes, architect children should load the same normal bundled/user/trusted-project extensions as the main Selesai CLI.**
   - This does not mean an architect can necessarily *use every tool*: its `tools: read, grep, find, ls` configuration constrains built-in tools, while extension-provided tools remain subject to the extension’s registration/permissions and any CLI tool filtering.

4. **Runtime-probe status**
   - I could not execute commands in this delegated environment (only read/search/list tools are exposed). The supervisor was asked to run a real-child probe.
   - The existing `src/extensions/pi-subagents/test/e2e/real-session-subagent.test.ts` does prove a real child subprocess receives explicit extension arguments, but is **not sufficient** to prove production bundled loading: its shim in `test/support/real-session-child-cli.mjs` uses a custom `DefaultResourceLoader`, rather than `src/main.ts` boot logic.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete static trace: src/main.ts:620-681 -> src/core/resource-loader.ts:388-447 -> src/core/package-manager.ts:2389-2524 for main loading; architect configuration at src/extensions/pi-subagents/agents/architect.md; child construction/spawn at src/extensions/pi-subagents/src/runs/shared/pi-args.ts:135-154 and src/extensions/pi-subagents/src/runs/foreground/execution.ts:181-218,291-297."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "No executable command tool was available to this delegated child. Static analysis establishes the normal architect path does not pass --no-extensions and preserves cwd plus inherited environment/config."
  ],
  "residualRisks": [
    "A production real-CLI nested-child probe remains required to attest runtime loading; the existing real-session E2E uses a shim loader and cannot establish bundled main-CLI loading.",
    "Project extensions load only when project trust resolves true; an untrusted project child will omit project-local extensions.",
    "Any agent with an explicit extensions allowlist differs: buildPiArgs adds --no-extensions and loads only its listed extensions plus internal runtime paths."
  ],
  "noStagedFiles": true,
  "diffSummary": "No tracked files modified.",
  "reviewFindings": [
    "moderate: src/extensions/pi-subagents/test/e2e/real-session-subagent.test.ts - its child shim does not exercise src/main.ts bundled-extension boot path, so it is not adequate evidence for the requested production behavior."
  ],
  "manualNotes": "Supervisor was asked to run a real production-child probe. Architect itself has no extension allowlist, so production behavior should use the same discovery path as its parent."
}
```

⧉ copy assistant: /cp 851bfe