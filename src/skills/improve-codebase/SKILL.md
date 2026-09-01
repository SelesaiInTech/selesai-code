---
name: improve-codebase
category: planning
description: improve codebase quality
disable-model-invocation: true
---

# Improve Codebase Architecture

Explore a codebase (or provided context) like an AI would. Surface architectural friction, identify deepening opportunities, and propose refactors as GitHub issue RFCs.

The input is already provided inline. Do NOT describe or restate it — use it directly.

---

## Core Principle

A **deep module** (John Ousterhout, "A Philosophy of Software Design") has a small interface hiding a large implementation.

Your goal:
- Reduce cognitive load
- Collapse shallow abstractions
- Move complexity behind stable boundaries
- Improve testability at module boundaries

---

## Process

### 1. Explore the context

Call the subagent tool with `{ agent: "scout", task: "..." }` (do not pass a model) when possible.

If the context is partial:
- Infer surrounding architecture cautiously
- Focus on local friction signals
- Avoid blocking on missing information

Explore organically. Do NOT follow rigid heuristics.

Look for friction:

- Does understanding one concept require jumping across multiple files or layers?
- Are modules shallow (interface ≈ implementation complexity)?
- Are “pure functions” extracted for testability, but orchestration is fragile?
- Are modules tightly coupled through shared types or call sequences?
- Are there hidden integration risks between layers?
- What is hard or impossible to test from the outside?

The friction you encounter IS the signal.

### 2. Identify candidate(s) and frame the problem

Analyze the context and identify deepening opportunities.

If the input clearly implies a specific target (file, module, diff, or instruction):
- Select the most relevant candidate automatically
- Do NOT present multiple options
- Proceed directly to framing the problem space below

If the input is ambiguous or spans multiple concerns:
- Present a numbered list of candidates

Each candidate must include:

- **Cluster**  
  Modules / files / concepts involved

- **Why they're coupled**  
  Shared types, execution flow, ownership of a concept

- **Dependency category**  
  Classify using `REFERENCE.md`:
  - In-process
  - Local-substitutable
  - Ports & adapters
  - True external

- **Test impact**  
  - Which tests become obsolete
  - What boundary tests would replace them

Then ask:
"Which of these would you like to explore?"
Wait for user input before continuing.

---

### Problem framing (execute immediately if a candidate is selected or inferred)

Explain the selected candidate clearly:

- Constraints a new interface must satisfy
- Dependencies it must handle
- What complexity needs to be hidden

Include a small illustrative code sketch to make constraints concrete.  
This is NOT a proposal.

After writing this, immediately proceed to Step 5: Design multiple interfaces.

### 5. Design multiple interfaces

Spawn 3+ sub-agents in parallel using the subagent tool (`tasks: [...]`).

Each sub-agent gets:
- A focused technical brief derived from the provided context
- Clear coupling + dependency context
- A distinct design constraint

Required variants:

- Agent 1: Minimize interface (1–3 entry points max)
- Agent 2: Maximize flexibility / extensibility
- Agent 3: Optimize for the most common caller
- Agent 4 (if relevant): Ports & adapters oriented design
- ...

---

### Each sub-agent must output:

1. Interface signature (types, methods, params)
2. Usage example
3. Hidden complexity (what gets absorbed internally)
4. Dependency strategy (per `REFERENCE.md`)
5. Trade-offs

---

### Synthesis

After all designs:

- Compare approaches in prose
- Highlight meaningful differences (not superficial ones)
- Identify where each design wins/fails

Then give a strong recommendation:
- Pick the best design OR
- Propose a hybrid

Be opinionated.

---

### 6. User picks an interface (or accepts recommendation)

---

### 7. Create Branch

Create a new branch for implementation.

Branch name should reflect the domain concept being deepened.

Examples:
- deepen-payment-orchestration
- deepen-map-rendering-pipeline

---

## Behavior Rules

- Do NOT restate or summarize the provided input
- Do NOT overfit to file structure — think in conceptual modules
- Do NOT suggest incremental refactors — prefer boundary redefinition
- Do NOT preserve bad abstractions — collapse aggressively
- Prefer fewer, deeper modules over many shallow ones
- Tests must move to the boundary, not remain internal

---

## Handling Incomplete Context

- Make reasonable assumptions
- State them explicitly
- Continue without blocking

Do NOT ask for more information unless absolutely necessary.