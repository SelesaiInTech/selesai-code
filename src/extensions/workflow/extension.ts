// ponytail: single pi extension that mounts every workflow mode. One load
// resolves a single writer tool + N start/end tool pairs. Avoids the per-mode
// load conflict (multiple extension modules would each try to register the
// shared writer).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { __resetWorkflowRegistryForTests, createWorkflowExtension } from "./adapter.ts";
import { prototypeMode } from "./modes/prototype.ts";
import { quickMode } from "./modes/quick.ts";

export { __resetWorkflowRegistryForTests };

const MODES = [prototypeMode, quickMode] as const;

export default function workflowModesExtension(pi: ExtensionAPI): void {
  for (const mode of MODES) {
    createWorkflowExtension(mode.config, {
      toolNames: mode.toolNames,
      toolLabels: mode.toolLabels,
      commandName: mode.commandName,
      commandDescription: mode.commandDescription,
    })(pi);
  }
}
