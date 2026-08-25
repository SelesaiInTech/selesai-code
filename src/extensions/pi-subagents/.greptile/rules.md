# pi-subagents review rules

Only report findings that identify a concrete, reachable release risk, direct contract contradiction, or clear local simplification. Avoid speculative hardening, broad rewrites, optional future-proofing, and unsupported edge-case warnings.

Before describing a PR as safe to merge or merge-ready, verify the process gates that matter for this repository:

- material external contributors are credited in `CHANGELOG.md` or release notes with login/name and PR or issue number;
- focused validation is present for changed behavior;
- required CI has run on the exact PR head;
- docs and tests match the actual runtime behavior.

If a process gate is missing, report it as a merge gate rather than a code defect.

For tests, prefer narrow changed-file or focused regressions. Do not request broad integration or E2E coverage unless the change actually crosses that behavior boundary.

For TypeScript changes, preserve existing error signals and local project patterns. Avoid wrappers that turn useful errors into `null`, defaults, or less-informative results.
