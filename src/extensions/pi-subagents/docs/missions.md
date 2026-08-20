# Missions

Durable records for delegated work: missions wrap runs so you can recover them later.

## Missions

Missions are durable wrappers around runs. The noun map:

- **Project/codebase** — where work happens.
- **Mission** — why delegated work exists and how to recover it later.
- **Run** — one actual subagent execution.
- **Receipt** — proof or a link for an external outcome, such as a PR, CI check, deployment, or release.

Ordinary workflow launches create one enclosing mission by default, with detailed JSON records under `~/.selesai/agent/missions/projects/<project-hash>/` linking objectives, run ids, lifecycle status, decisions, artifact paths, and delivery receipts. Workflow children do not create separate missions. Each workflow child attempt is stored in the enclosing mission with its stable workflow key, run id when known, agent, task metadata, timestamps, session and artifact paths, and latest status heartbeat.

Records created under the old default `<project>/.pi-subagents/missions` stay on disk. Continue them by setting `missions.directory` to that path for the project or by copying the record into the new agent-dir project store. There is no automatic migration.

Behavior:

- Automatic persistence failures do not block the run and are reported as `details.missionWarning`. Explicit `missionId` and `mission` requests remain strict before launch.
- Human receipts end with `Mission: <id> (<status>)`, while JSON/structured output text stays unchanged and `details.missionId` is authoritative.
- Pass `mission: false` for an intentionally ephemeral workflow. It creates no mission for the workflow or its children and has no `state` global.
- Set `missions.enabled: false` to disable automatic mission creation; explicit mission fields and actions still work.
- A workflow with a mission can use `await state.get(key)` and `await state.set(key, value)` for durable JSON state. Missing keys return `undefined`. Keys use the same format as `runs.run` keys. Each set takes the state-file lock, reads the latest file, merges the key, and atomically writes `<mission-directory>/<mission-id>/state.json`. The complete file cannot exceed 256 KiB. Each workflow caches the file on its first `get`. A `mission:false` workflow has no `state` global.

An explicit `mission` object must have exactly one non-empty `title` or `summary`. `objective` and `labels` are optional. When supplied, `goal` must be `true` and requires `budget: { tokens: <positive integer> }`.

```ts
const created = subagent({
  action: "mission.create",
  mission: { title: "Ship auth refresh", objective: "Implement and validate token refresh" }
})
subagent({
  workflowScript: `return runs.run("main", { agent: "worker", task: "Implement the approved auth refresh plan" })`,
  missionId: "<mission-id>"
})

// Or create and attach in one launch
subagent({
  workflowScript: `return runs.run("main", { agent: "worker", task: "Implement the approved plan" })`,
  mission: { title: "Ship auth refresh" }
})
```

### Goal missions

Set `goal: true` with a token budget to make an open mission an active continuation driver:

```ts
subagent({
  action: "mission.create",
  mission: {
    title: "Ship auth refresh",
    objective: "Implement and validate token refresh",
    goal: true,
    budget: { tokens: 400000 }
  }
})
```

After each parent turn, an idle goal mission sends one needs-attention notice with its title, remaining token budget, and next ready action. The action comes from `state.nextReadyAction`, `state.nextAction`, a state item with `status: "ready"`, an open decision, or linked-run state. A workflow can write `state.nextReadyAction` to tell the next notice exactly what work is ready. When the latest linked workflow has a resumable retained child, the notice names that child as the `resume` target. Non-resumable retained children stay visible in `children.list` with their reason, but goal notices do not present them as resume targets. The extension never launches or replans goal work by itself.

Linked-run token totals are stored on each run and folded into mission `usage`. An active linked run suppresses notices. Reaching the token budget changes the goal status to `budget-exhausted` and stops notices without closing the mission or reporting success.

Pause and resume notices with `mission.update` and `{ goal: { paused: true } }` or `{ goal: { paused: false } }`. Set `{ goal: false }` to disable goal mode. `mission.close` also ends the loop.

### Managing missions

Use `mission.list`, `mission.show`, `mission.update`, `mission.resolve-decision`, `mission.attach-run`, and `mission.close`.

- Use `mission.update` to record decisions, artifacts, labels, summaries, and delivery receipts while work runs. Adding a decision gates active or completed missions as `needs_decision`; planned and waiting missions keep their lifecycle status while the decision stays visible. Resolve it with `mission.resolve-decision`, `missionId`, the decision `id`, and a resolution in `summary`. A gated mission returns to `active` after its last open decision is resolved.
- `mission.show` includes each workflow child's latest status, phase, update time, session path metadata, and heartbeat. The ledger is a recovery record only. It does not schedule or restart children.
- Receipts are durable links for pull requests, CI, deployments, or releases, each with `kind`, `status`, `title`, `url`, and optional `description`. They record delivery state only; pi-subagents does not merge, poll CI, or deploy.
- Use `mission.close` with a terminal status and summary when a mission is done.
- After compaction or restart, resume from `mission.list`/`mission.show` first: `mission.show` refreshes linked async status where available, then use the linked run ids with normal `status`, `steer`, `resume`, or `stop` actions.
- `mission.list` with `missionScope: "global"` reads the user-local pointer index under the Selesai agent directory. Project records remain the source of truth, and missing records are reported as stale rather than hiding other projects.

### Cross-project work

Keep same-project tasks on ordinary subagents. Use an explicit `cwd` for small bounded work in another project.

For substantial or long-running work in another project, open a project-owned Herdr pane with `project.open` and give that project Selesai session a narrow mission/result contract (see [extension-api.md](extension-api.md#herdr-integration)). The project pane owns its own subagents; do not model it as ordinary child nesting or expect existing headless runs to move into the pane.

Mission storage configuration (`missions.directory`, `retainTerminal`, `globalIndex`) is in [configuration.md](configuration.md#missions).
