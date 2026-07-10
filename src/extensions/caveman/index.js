import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getCavemanInstructions } = require("./caveman-instructions.cjs");

export { getCavemanInstructions };



export function parseCavemanCommand(text) {
  const normalizedText = String(text || "").trim().toLowerCase();
  if (!normalizedText) return { type: "toggle" };

  const [primary] = normalizedText.split(/\s+/);
  if (primary === "status") return { type: "status" };
  if (primary === "on" || primary === "enable") return { type: "set", active: true };
  if (primary === "off" || primary === "disable") return { type: "set", active: false };
  return { type: "invalid", reason: "unknown-subcommand", arg: primary };
}

export function isDeactivationCommand(text) {
  const t = String(text || "").trim().toLowerCase().replace(/[.!?\s]+$/, "");
  return t === "stop caveman" || t === "normal mode";
}

export function resolveSessionActive(entries, fallback = true) {
  if (!Array.isArray(entries)) return fallback;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== "custom" || entry?.customType !== "caveman-mode") continue;

    const active = entry?.data?.active;
    if (typeof active === "boolean") return active;
  }

  return fallback;
}

export default function cavemanExtension(pi) {
  let active = true;
  let isActive = false;
  let lastCtx = null;

  function syncStatus(ctx) {
    if (ctx) lastCtx = ctx;
    const c = ctx || lastCtx;
    if (!c?.ui?.setStatus || !c.ui.theme?.fg) return;
    const theme = c.ui.theme;
    if (!active) {
      c.ui.setStatus("caveman", "");
      return;
    }
    const indicator = isActive ? theme.fg("accent", "●") : theme.fg("dim", "○");
    c.ui.setStatus("caveman", indicator + " 🦴 " + theme.fg("muted", "caveman: ") + theme.fg("text", active ? "ON" : "OFF"));
  }

  const setActive = (value, ctx) => {
    active = Boolean(value);
    pi.appendEntry("caveman-mode", { active });
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Caveman mode ${active ? "enabled" : "disabled"}.`, "info");
  };

  pi.registerCommand("caveman", {
    description: "Toggle or report Caveman mode",
    handler: async (args, ctx) => {
      const parsed = parseCavemanCommand(args);

      if (parsed.type === "status") {
        ctx?.ui?.notify?.(`Caveman: ${active ? "ON" : "OFF"}`, "info");
        return;
      }

      if (parsed.type === "toggle") {
        setActive(!active, ctx);
        return;
      }

      if (parsed.type === "set") {
        setActive(parsed.active, ctx);
        return;
      }

      ctx?.ui?.notify?.("Unknown /caveman subcommand. Use: on, off, status.", "warning");
    },
  });

  pi.on("input", async (event) => {
    if (event?.source === "extension") return;
    const text = String(event?.text || "");
    if (active && isDeactivationCommand(text)) {
      setActive(false);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
    active = resolveSessionActive(entries);
    syncStatus(ctx);
    ctx?.ui?.notify?.(`Caveman loaded: ${active ? "ON" : "OFF"}`, "info");
  });

  pi.on("agent_start", async (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    if (!active) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${getCavemanInstructions()}` };
  });
}