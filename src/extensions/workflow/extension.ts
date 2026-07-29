// ponytail: single pi extension that mounts every workflow mode. One load
// resolves a single writer tool + N start/end tool pairs. Avoids the per-mode
// load conflict (multiple extension modules would each try to register the
// shared writer).

import type { ExtensionAPI } from "@selesai/code";
import { __resetWorkflowRegistryForTests, createWorkflowExtension } from "./adapter.ts";
import { prototypeMode } from "./modes/prototype.ts";
import { quicktypeMode } from "./modes/quicktype.ts";
import { taskMode } from "./modes/task.ts";
import { loopMode } from "./modes/loop.ts";

export { __resetWorkflowRegistryForTests };

const MODES = [prototypeMode, quicktypeMode, taskMode, loopMode] as const;

export default function workflowModesExtension(pi: ExtensionAPI): void {
  for (const mode of MODES) {
    createWorkflowExtension(mode.config, {
      commandName: mode.commandName,
      commandDescription: mode.commandDescription,
    })(pi);
  }
}
