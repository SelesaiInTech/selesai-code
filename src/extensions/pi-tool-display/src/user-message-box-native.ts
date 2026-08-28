import {
  type ExtensionAPI,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  patchNativeUserMessagePrototype,
  type PatchableUserMessagePrototype,
  type UserMessageTheme,
} from "./user-message-box-renderer.js";
import { unregisterUserMessageRenderPrototypePatch } from "./user-message-box-patch.js";
import type { ToolDisplayConfig } from "./types.js";
import { onReloadShutdown } from "./extension-lifecycle.js";

const registeredNativeUserMessageApis = new WeakSet<ExtensionAPI>();

function getUserMessagePrototype(): PatchableUserMessagePrototype {
  return UserMessageComponent.prototype as unknown as PatchableUserMessagePrototype;
}

function patchUserMessageRender(
  getTheme: () => UserMessageTheme | undefined,
  isEnabled: () => boolean,
): void {
  patchNativeUserMessagePrototype(
    getUserMessagePrototype(),
    getTheme,
    isEnabled,
  );
}

function restoreUserMessageRender(): void {
  unregisterUserMessageRenderPrototypePatch(getUserMessagePrototype());
}

export default function registerNativeUserMessageBox(
  pi: ExtensionAPI,
  getConfig: () => ToolDisplayConfig,
): void {
  if (registeredNativeUserMessageApis.has(pi)) {
    return;
  }
  registeredNativeUserMessageApis.add(pi);

  let activeTheme: UserMessageTheme | undefined;

  const getTheme = (): UserMessageTheme | undefined => activeTheme;
  const isEnabled = (): boolean => getConfig().enableNativeUserMessageBox;

  patchUserMessageRender(getTheme, isEnabled);

  onReloadShutdown(pi, () => {
    restoreUserMessageRender();
    activeTheme = undefined;
    registeredNativeUserMessageApis.delete(pi);
  });

  pi.on("before_agent_start", async () => {
    patchUserMessageRender(getTheme, isEnabled);
  });

  pi.on("session_start", async (_event, ctx) => {
    activeTheme = ctx?.ui?.theme as unknown as UserMessageTheme;
    patchUserMessageRender(getTheme, isEnabled);
  });

}
