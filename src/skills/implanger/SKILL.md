---
name: implanger
category: planning
description: Execute the Planger's style planning
argument-hint: "For Subagent to be able to understand Planger and can execute it perfectly"
disable-model-invocation: true
---

## Goal

Implement the requested change with the smallest correct modification.

## Before Changing Code

- Read surrounding code
- Follow existing patterns
- Verify assumptions
- Trace usages when needed

Never assume behavior that can be inspected.

## Implementation Rules

- Prefer consistency over preference
- Make the smallest correct change
- Reuse existing code before creating new code
- Do not solve future problems
- Do not refactor unrelated areas
- Do not introduce abstractions for one use case

## Backward Compatibility

Do not add:

- Wrappers
- Adapters
- Fallbacks
- Feature flags
- Dual execution paths

unless explicitly required.

When replacing behavior:

1. Find usages
2. Update usages
3. Remove obsolete code

Prefer one source of truth.

## Comments

Only explain:

- Business rules
- External constraints
- Vendor quirks
- Non-obvious decisions

Do not narrate code.

## Validation

Before completion verify:

- Requirement satisfied
- Scope remained limited
- Existing patterns followed
- No unnecessary complexity added
- No dead code remains
