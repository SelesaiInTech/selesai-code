## Reuse decision: skip broad exploration

Existing reusable seam already identified directly:

- `ToolExecutionComponent.updateArgs(args)` refreshes call rendering.
- `InteractiveMode` already owns `tool_execution_update` delivery and result refresh.
- `AgentSession` already forwards update args after the RTK `tool_call` mutation.

No new abstraction, dependency, or cross-module pattern needed; implement the missing existing method call and a focused regression test.