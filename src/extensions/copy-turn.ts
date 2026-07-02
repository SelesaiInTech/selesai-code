import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@selesai/code";
import { copyToClipboard } from "@selesai/code";
import { Text } from "@earendil-works/pi-tui";

type AnyMessage = any;
const EXT = "copy-turn";
const HASH_LEN = 6;
const MARK_RE = /\n?\n?\s*⧉ copy(?:\s+\w+)?: \/cp ([0-9a-f]{6,12})\s*$/;

function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ""); }
function stripMark(s: string): string { return s.replace(MARK_RE, "").trimEnd(); }
function mark(hash: string, role = "assistant"): string { return `\n\n⧉ copy ${role}: /cp ${hash}`; }

function textFromContent(content: unknown): string {
  if (typeof content === "string") return stripMark(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((b: any) => b?.type === "text" ? stripMark(b.text ?? "") : "")
    .filter(Boolean)
    .join("\n");
}

function cleanMessage(m: AnyMessage): AnyMessage {
  const c = structuredClone(m);
  if (typeof c.content === "string") c.content = stripMark(c.content);
  else if (Array.isArray(c.content)) {
    c.content = c.content.map((b: any) => b?.type === "text" ? { ...b, text: stripMark(b.text ?? "") } : b);
  }
  return c;
}

function resultOf(message: AnyMessage): string {
  const clean = cleanMessage(message);
  if (clean.role === "bashExecution") {
    return [clean.command ? `$ ${clean.command}` : "", clean.output ?? ""].filter(Boolean).join("\n").trim();
  }
  return textFromContent(clean.content).trim();
}

function hashFor(m: AnyMessage): string {
  return createHash("sha1").update(JSON.stringify(cleanMessage(m))).digest("hex").slice(0, HASH_LEN);
}

function addMarker(m: AnyMessage): AnyMessage {
  const h = hashFor(m);
  const out = structuredClone(m);
  const role = out.role ?? "message";
  if (typeof out.content === "string") out.content = stripMark(out.content) + mark(h, role);
  else if (Array.isArray(out.content)) {
    const lastText = out.content.findLastIndex((x: any) => x?.type === "text");
    if (lastText >= 0) {
      out.content = out.content.map((b: any, i: number) =>
        i === lastText ? { ...b, text: stripMark(b.text ?? "") + mark(h, role) } : b
      );
    } else {
      out.content.push({ type: "text", text: mark(h, role).trimStart() });
    }
  }
  return out;
}

function branchMessages(ctx: any): AnyMessage[] {
  return (ctx.sessionManager?.getBranch?.() ?? [])
    .filter((e: any) => e?.type === "message" && e.message)
    .map((e: any) => e.message)
    .filter((m: any) => !(m.role === "custom" && m.customType === EXT));
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer(EXT, (message: any, _options: any, theme: any) => {
    const h = message.details?.hash ?? textFromContent(message.content).match(/[0-9a-f]{6,12}/)?.[0] ?? "??????";
    const role = message.details?.role ?? "message";
    return new Text(theme.fg("dim", `⧉ copy ${role}: /cp ${h}`), 0, 0);
  });

  pi.on("message_end", async (event: any) => {
    const m = event.message;
    if (!m) return;

    if (m.role === "user") {
      const text = resultOf(m);
      if (!text) return;
      const h = hashFor(m);
      pi.sendMessage({
        customType: EXT,
        content: `⧉ copy user: /cp ${h}`,
        display: true,
        details: { hash: h, role: "user" },
      } as any, { deliverAs: "steer" } as any);
      return;
    }

    // Assistant messages can happen multiple times during tool loops; mark only final result.
    if (m.role !== "assistant") return;
    if (m.stopReason === "toolUse") return;
    if (!resultOf(m)) return;
    return { message: addMarker(m) };
  });

  // Remove copy markers/custom copy rows from model context.
  pi.on("context", async (event: any) => ({
    messages: event.messages
      .filter((m: any) => !(m.role === "custom" && m.customType === EXT))
      .map(cleanMessage),
  }));

  pi.registerCommand("cp", {
    description: "Copy message result by hash",
    handler: async (args: string, ctx: any) => {
      const hash = args.trim().split(/\s+/).filter(Boolean)[0];
      if (!hash) return ctx.ui.notify("Usage: /cp <hash>", "warning");

      const matches = branchMessages(ctx).map((m) => [hashFor(m), m] as const).filter(([h]) => h.startsWith(hash));
      if (matches.length === 0) return ctx.ui.notify(`No message for hash ${hash}`, "warning");
      if (matches.length > 1) return ctx.ui.notify(`Hash ${hash} ambiguous: ${matches.map(([h]) => h).join(", ")}`, "warning");

      const [fullHash, message] = matches[0]!;
      const text = stripAnsi(resultOf(message)).trim();
      if (!text) return ctx.ui.notify(`No result content for ${fullHash}`, "warning");
      await copyToClipboard(text);
      ctx.ui.notify(`Copied ${fullHash} (${text.length} chars)`, "info");
    },
  });
}
