---
name: selesai-default
description: Default Selesai skill. A minimal example showing how bundled skills are shipped in src/skills/ and loaded at boot via additionalSkillPaths. Safe to delete or replace.
---

# Selesai Default Skill

This skill ships inside `@selesai/code` under `src/skills/` and is loaded
automatically at boot (same hook as `--skill`), so every Selesai install gets
it without users copying anything to `~/.selesai/agent/skills/`.

Add more bundled skills by creating sibling directories here, each with its own
`SKILL.md` (YAML frontmatter `name` + `description`, then the body). The build
copies the whole `src/skills/` tree into `dist/skills/`.

To disable all skills at runtime: `selesai --no-skills`.
