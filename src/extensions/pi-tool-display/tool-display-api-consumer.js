const TOOL_DISPLAY_API_KEY = Symbol.for("pi-tool-display.api.v1");
const TOOL_DISPLAY_PENDING_DECORATIONS_KEY = Symbol.for("pi-tool-display.pendingDecorations.v1");

export function getToolDisplayApi() {
  const api = globalThis[TOOL_DISPLAY_API_KEY];
  if (api?.version !== 1 || typeof api.decorateTool !== "function") {
    return undefined;
  }

  return api;
}

export function queueToolDisplayDecoration(tool, adapter) {
  const existing = globalThis[TOOL_DISPLAY_PENDING_DECORATIONS_KEY];
  const queue = Array.isArray(existing) ? existing : [];
  queue.push({ tool, adapter });
  globalThis[TOOL_DISPLAY_PENDING_DECORATIONS_KEY] = queue;
}

export function decorateToolForDisplay(tool, adapter, options = {}) {
  const api = getToolDisplayApi();
  if (!api) {
    queueToolDisplayDecoration(tool, adapter);
    return tool;
  }

  try {
    return api.decorateTool(tool, adapter);
  } catch (error) {
    if (options.suppressDecorateErrors) {
      return tool;
    }

    throw error;
  }
}

export function decorateMcpToolForDisplay(tool) {
  return decorateToolForDisplay(tool, { kind: "mcp", overrideExistingRenderers: true });
}
