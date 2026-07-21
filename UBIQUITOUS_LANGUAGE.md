# Ubiquitous Language

## Agent execution

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Main session** | The top-level Selesai session that initiates delegated work. | Main agent, parent agent |
| **Subagent** | A Selesai session started by a main session to perform a bounded task. | Child agent, spawned agent |
| **Architect subagent** | The read-only `architect` subagent persona used to produce implementation plans. | Architecture subagent, architect child |
| **Child process** | The operating-system process that runs a subagent session. | Child, subprocess agent |
| **Parent session** | The session that owns and delegates work to a subagent. | Orchestrator, caller |

## Extension lifecycle

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Extension** | A Selesai resource that can register tools, commands, handlers, or UI behavior. | Plugin, addon, module |
| **Bundled extension** | An extension shipped with Selesai and loaded from the package's bundled extension directory. | Built-in extension, native extension |
| **Extension discovery** | The process of finding eligible extension sources from bundled, user, project, or explicitly supplied paths. | Extension loading, extension scan |
| **Extension loading** | The process of evaluating discovered extension sources and creating their registered resources. | Extension discovery, bootstrapping |
| **Tool registration** | An extension's declaration of a callable tool in a session runtime. | Tool loading, tool exposure |
| **Extension allowlist** | An agent configuration that explicitly limits which extensions a child may load. | Extension list, extensions config |

## Configuration and trust

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Agent directory** | The Selesai directory containing user settings, extensions, sessions, and related runtime state. | Config directory, Selesai home |
| **Project trust** | The decision that permits project-local resources to participate in resource discovery. | Trusted project, trust mode |
| **Effective working directory** | The project directory used by a session for project resources and relative paths. | Current directory, cwd |
| **Child marker** | The environment signal identifying a process as a subagent child. | Child flag, subagent mode |

## Relationships

- A **Main session** creates one or more **Subagents**.
- A **Subagent** runs in exactly one **Child process**.
- A **Parent session** owns the delegation relationship for its **Subagent**.
- **Extension discovery** considers **Bundled extensions**, user extensions, and project extensions when **Project trust** permits them.
- **Extension loading** follows **Extension discovery** and produces **Tool registrations** and other runtime resources.
- An **Extension allowlist** replaces normal extension discovery for the configured child, except for required runtime extensions.
- A **Child marker** identifies a **Child process** without, by itself, preventing unrelated **Bundled extensions** from loading.
- The `pi-subagents` **Extension** recognizes the **Child marker** and intentionally registers no delegation tools in that child.

## Example dialogue

> **Dev:** "Does the **Architect subagent** load the same **Bundled extensions** as the **Main session**?"
>
> **Domain expert:** "Yes, when it has no **Extension allowlist**. Its **Child process** keeps the same **Agent directory** and **Effective working directory**, so normal **Extension discovery** runs."
>
> **Dev:** "Does that mean the child gets the `subagent` tool too?"
>
> **Domain expert:** "No. The `pi-subagents` **Extension** sees the **Child marker** and skips its own **Tool registration**, while unrelated extensions such as `grep-app` still register their tools."

## Flagged ambiguities

- "Architecture subagent" and "architect subagent" were used for the same persona. Use **Architect subagent** for the configured `architect` agent.
- "Main agent" and "parent agent" can describe either a persona or a session. Use **Main session** for the top-level runtime and **Parent session** for the delegation relationship.
- "Extension loading" was used to mean both finding extensions and registering their tools. Use **Extension discovery** for finding sources and **Extension loading** for evaluating them.
- "Child" was used for both a process and an agent. Use **Subagent** for the delegated runtime and **Child process** for its operating-system process.
- "Same as the main agent" is too broad: a child shares normal extension discovery but may intentionally omit tools from the `pi-subagents` extension because of the **Child marker**.
