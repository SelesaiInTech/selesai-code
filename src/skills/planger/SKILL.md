---
name: planger
description: Create decomposed planning for sub agent
argument-hint: "How i provide a good plan for subagent"
---

# Planning Skill

## Goal

Create implementation plans that can be executed by a small coding model with:

- Limited context window
- No project knowledge
- No memory of previous conversation
- Weak architectural understanding
- No ability to infer missing steps

Assume the executor only knows what is written in the plan.

# Core Principles

## Discovery First

Never assume:

- File names
- File locations
- Ownership of behavior
- Existing abstractions
- Existing utilities

If the code has not been inspected, the plan must begin with discovery.
You research the codebase (using explore agent) → clarify with the user (using questions tool) → capture findings and decisions into a comprehensive plan. This iterative approach catches edge cases and non-obvious requirements BEFORE implementation begins.

## Simplicity First

Prefer the smallest maintainable solution that satisfies the requirement.

Avoid:

- New abstractions
- New services
- New dependencies
- Large refactors
- Generic frameworks
- Future-proofing for hypothetical requirements

Choose the lowest-complexity solution that works.

## Reuse Before Build

Before creating anything new (use explorer agent):

- Search for existing implementations
- Search for existing utilities
- Search for existing patterns
- Search for existing tests

Reuse existing code when reasonable.

Do not duplicate behavior unless duplication is clearly preferable.

## Scope Discipline

Only modify code required for the task.

Allowed:

- Small cleanup in touched files
- Remove unused imports
- Remove obvious dead code
- Improve nearby naming

Not allowed:

- Unrelated refactors
- Architecture changes
- Broad cleanup efforts
- Dependency migrations

# Task Structure

Every implementation task must contain:

## 1. Discovery

Describe:

- What to search for
- Where to search
- How to identify relevant code

Example:

Search for:

- Authorization
- Bearer
- Interceptor
- Refresh token

Inspect matching files and identify where authentication headers are attached.

## 2. Identification

Describe:

- Exact file(s) to modify
- Why those files own the behavior
- Why other files should not be modified

## 3. Change

Describe:

- Exact modification required
- Functions/classes affected
- Existing code to reuse
- New code to add
- Code explicitly not to add

The executor should know exactly what to implement.

## 4. Verification

Include:

### Success Cases

Expected working behavior.

### Failure Cases

Expected error behavior.

### Regression Checks

Existing behavior that must remain unchanged.

# Granularity Rule

A task is too large if it can be split into smaller independently verifiable work.

Keep decomposing until each task:

- Has one objective
- Has clear ownership
- Can be implemented independently
- Can be verified independently

Prefer 5 small tasks over 1 large task.

# Final Review

Before returning a plan verify:

- Discovery exists
- Ownership is justified
- Solution is the simplest acceptable approach
- Existing code is reused when possible
- No unnecessary abstractions are introduced
- Scope remains limited
- Verification is included
- Every step is executable without additional assumptions
