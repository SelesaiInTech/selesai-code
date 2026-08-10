# Contributing

Thanks for helping improve `pi-powerline-footer`.

For bug reports, include the powerline version, Pi version, OS, terminal, your relevant `powerline` settings, what you expected, what happened, and exact reproduction steps. Screenshots are useful for rendering issues, but please also paste any terminal error text or stack trace.

For feature or config requests, describe the workflow you are trying to improve, the setting shape you expect to use, and whether the behavior should be enabled by default or opt-in.

For PRs, keep the change narrow and include tests for behavior changes when possible. Update `README.md` for user-facing settings or shortcuts, and update `CHANGELOG.md` under `[Unreleased]` with contributor credit when the change comes from an issue, PR, report, or review.

Before opening a PR, run:

```bash
npm test
git diff --check
```
