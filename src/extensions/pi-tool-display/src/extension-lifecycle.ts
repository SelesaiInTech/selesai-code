import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register a session_shutdown handler that runs cleanup only when the
 * session is shutting down for a reload. Centralizes the reload-detection
 * check shared by extension registration modules.
 */
export function onReloadShutdown(pi: ExtensionAPI, cleanup: () => void): void {
  pi.on("session_shutdown", async (event: { reason?: string }) => {
    if (event?.reason === "reload") {
      cleanup();
    }
  });
}
