## Summary

<!--
Briefly describe what this PR changes and why.
Focus on user-facing behavior: footer, editor, user-message styling, runtime/git detection, `/zentui` settings, config, or packaging.
Link related issues with "Closes #123" or "Refs #123" where applicable.
-->

## Screenshots / recordings

<!--
Required for footer, editor, user-message, or rendering changes whenever practical.
A short terminal recording (asciinema, GIF, or video) is preferred over a still image.
If the change is purely internal (build, types, tests, docs), say "N/A" and explain.
-->

## Testing

<!--
Run these locally before requesting review. Tick everything that applies.
-->

- [ ] `npm run verify`
- [ ] `npm run pack:check`
- [ ] Manual Pi test via `npm run pi:dev` (required for UI behavior changes)
- [ ] Added or updated tests where practical

## Checklist

- [ ] Preserved Nerd Font / private-use icon glyphs (no empty strings or replaced characters).
- [ ] Updated `README.md` or config docs if user-facing behavior changed.
- [ ] Kept the diff surgical: no unrelated refactors, formatting, or dependency churn.
- [ ] `extensions/zentui/index.ts` stays mostly orchestration; new logic lives in a focused module.
- [ ] Used a conventional commit-style PR title (e.g. `feat: add ...`, `fix: handle ...`).
