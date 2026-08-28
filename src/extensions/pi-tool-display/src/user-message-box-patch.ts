export type UserMessageRenderFn = (width: number) => string[];

const USER_MESSAGE_PATCH_OWNER = {};

export interface PatchableUserMessagePrototype {
  render: UserMessageRenderFn;
  __piUserMessageOriginalRender?: UserMessageRenderFn;
  __piUserMessageNativePatched?: boolean;
  __piUserMessagePatchVersion?: number;
  __piUserMessagePatchOwner?: object;
}

export function unregisterUserMessageRenderPrototypePatch(
  prototype: PatchableUserMessagePrototype,
): void {
  const originalRender = prototype.__piUserMessageOriginalRender;
  if (typeof originalRender === "function") {
    prototype.render = originalRender;
  }

  delete prototype.__piUserMessageOriginalRender;
  delete prototype.__piUserMessageNativePatched;
  delete prototype.__piUserMessagePatchVersion;
  delete prototype.__piUserMessagePatchOwner;
}

export function patchUserMessageRenderPrototype(
  prototype: PatchableUserMessagePrototype,
  patchVersion: number,
  buildRender: (originalRender: UserMessageRenderFn) => UserMessageRenderFn,
): void {
  if (typeof prototype.render !== "function") {
    return;
  }

  const previousOriginalRender = prototype.__piUserMessageOriginalRender;
  const hasPreviousPatch = typeof previousOriginalRender === "function"
    && previousOriginalRender !== prototype.render;
  const isCurrentPatch = prototype.__piUserMessagePatchOwner === USER_MESSAGE_PATCH_OWNER;
  let restoredStalePatch = false;

  if (hasPreviousPatch && !isCurrentPatch) {
    prototype.render = previousOriginalRender;
    delete prototype.__piUserMessageNativePatched;
    delete prototype.__piUserMessagePatchVersion;
    delete prototype.__piUserMessagePatchOwner;
    restoredStalePatch = true;
  }

  if (
    !restoredStalePatch
    && prototype.__piUserMessageNativePatched
    && prototype.__piUserMessagePatchVersion === patchVersion
    && typeof prototype.__piUserMessageOriginalRender === "function"
  ) {
    return;
  }

  if (!prototype.__piUserMessageOriginalRender) {
    prototype.__piUserMessageOriginalRender = prototype.render;
  }

  const originalRender = prototype.__piUserMessageOriginalRender;
  if (!originalRender) {
    return;
  }

  prototype.render = buildRender(originalRender);
  prototype.__piUserMessageNativePatched = true;
  prototype.__piUserMessagePatchVersion = patchVersion;
  prototype.__piUserMessagePatchOwner = USER_MESSAGE_PATCH_OWNER;
}
