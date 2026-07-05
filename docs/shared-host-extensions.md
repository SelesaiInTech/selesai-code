# Shared Host Extensions

Selesai is a pi fork with its own config directory (`~/.selesai/agent/`). By default it only reads your extensions from there. If you already use `pi` and have extensions installed under `~/.pi/agent/extensions/`, you can let selesai reuse them without duplicating auth, sessions, models, or settings.

This page covers three things:

1. The shared-host fallback (how selesai reads pi's extensions).
2. Collisions: what happens when the same extension exists in both.
3. Picking the winner per extension via `extensionHost`.

## What gets shared, and what does not

| Read from `~/.pi/agent/` | Kept separate under `~/.selesai/agent/` |
|---|---|
| `extensions/` | `auth.json` |
| | `models.json` |
| | `settings.json` |
| | `sessions/` |
| | `skills/`, `prompts/`, `themes/` |

Only **extensions** are shared from the pi host dir. Everything tied to your identity, model defaults, and settings stays in selesai's own dir. This means you can keep a single set of API keys in `~/.pi/agent/auth.json` for pi, and a different set in `~/.selesai/agent/auth.json` for selesai, while both agents load the same extension code.

The host directory is hardcoded to `~/.pi/agent/extensions`. If pi ever renames its config dir, selesai will silently stop loading pi's extensions — no error, the extensions just won't appear. There is no env var to override this; the path is deliberately fixed so your two installs can't drift into loading the wrong dir.

## Collisions: same extension in both dirs

If an extension named `pi-subagents` exists in both `~/.selesai/agent/extensions/` and `~/.pi/agent/extensions/`, selesai does **not** load both. Loading both causes split-brain problems for stateful extensions (timers, event handlers, watchers running twice with separate `state` objects), so selesai loads exactly one copy and drops the other.

The "name" used for dedup is the **top-level entry name** under the extensions dir:

- A packaged extension dir (e.g. `pi-subagents/` with a `package.json`) → the dir name `pi-subagents`.
- A loose `.ts` file (e.g. `copy-turn.ts`) → the file name `copy-turn.ts`.

If you fork `pi-subagents` into a dir called `my-subagents`, the names differ and both load — no collision.

### Default winner

Without any config, **selesai's copy wins**. The pi copy is dropped entirely (never loaded), and a warning is printed at startup:

```
Warning: Extension "pi-subagents" exists in both ~/.selesai/agent/extensions and ~/.pi/agent/extensions; loaded the selesai copy, skipped the other. Set "extensionHost": { "pi-subagents": "pi" } or "selesai" in settings.json to change the winner.
```

## Picking the winner: `extensionHost`

You control the winner per extension in `~/.selesai/agent/settings.json`:

```json
{
  "extensionHost": {
    "pi-subagents": "pi",
    "copy-turn.ts": "selesai"
  }
}
```

| Value | Behavior |
|---|---|
| `"selesai"` | selesai's copy loads, pi's is dropped. |
| `"pi"` | pi's copy loads, selesai's is dropped. |
| (omitted) | Default applies (= selesai wins). |

Typical reasons to pick `"pi"`:
- You hack on an extension under `~/.pi/agent/extensions/` and want both agents to run your working copy.
- pi's version is newer and you have not ported your changes into selesai yet.
- An extension carries host-specific state (a socket path, a lockfile).

Typical reasons to leave it at `"selesai"` (default):
- You have a selesai-specific fork and want it to shadow pi's.
- You are migrating toward selesai and are phasing pi's copy out.

The setting is scoped by name, so you can mix: keep pi's `pi-subagents` but use selesai's `copy-turn.ts`.

### Where to put it

Global (`~/.selesai/agent/settings.json`) applies to every project. Project-local `.selesai/settings.json` (or `.pi/settings.json` inside a trusted project) overrides per project, since project settings merge on top of global. See [settings.md](settings.md) for the full merge rules.

## Workflow: running pi and selesai side by side

1. Keep your current install as-is:
   ```
   ~/.pi/agent/
     extensions/      <- your shared extensions live here
     auth.json
     settings.json
   ~/.selesai/agent/
     extensions/      <- (optional) selesai-specific forks override the above
     auth.json        <- separate keys, separate sessions
     settings.json    <- add extensionHost here
   ```
2. If you hit a collision warning and want the other copy, add one line to `~/.selesai/agent/settings.json`:
   ```json
   { "extensionHost": { "pi-subagents": "pi" } }
   ```
3. Restart. The warning now reads that pi's copy won and selesai's was skipped.

## How detection works (under the hood)

- During resource resolution, selesai collects all enabled extensions from `~/.selesai/agent/extensions/`, then walks `~/.pi/agent/extensions/` for the rest.
- For each pi-host entry, it computes the top-level entry name and checks it against the selesai set.
- On a match, `extensionHost[name]` decides the winner; the loser is removed from the resolved set before anything loads, so no double-load of factories, no orphaned timers.
- Each drop is recorded as a collision and surfaced as a startup warning (see [Settings](settings.md) for where diagnostics are reported).

## Limitations

- **Only extensions are shared.** Skills, prompts, and themes in `~/.pi/agent/skills/` etc. are never read by selesai. Copy them into `~/.selesai/agent/` if you want them.
- **Only name collisions are deduped.** If two unrelated extensions register the same tool or command name (e.g. both define `/foo`), that conflict is handled by pi's normal first-registration-wins rule after load, not by `extensionHost`.
- **No version check.** If selesai's `pi-subagents` is 0.2.0 and pi's is 0.4.0, `extensionHost: { "pi-subagents": "pi" }` silently loads 0.4.0. Picking the winner is purely by install location, not by version. You are responsible for matching versions when you want consistent behavior.
- **Hardcoded host path.** If you rename pi's config dir away from `~/.pi`, selesai stops seeing it. There is no resolver hook yet.
