import { describe, expect, it } from "vitest";
import { fallbackTier, parseTier, priorHumanContext, resolveClassifierTier } from "./classifier.ts";
import { DEFAULT_CONFIG, configPaths, mergeConfig, updateConfig, validateOverride } from "./config.ts";

describe("auto-model classifier fallback", () => {
 it.each([["hello there", "simple"], ["fix the parser and run tests", "medium"], ["find the root cause across two systems", "complex"], ["plain architecture overview", "complex"], ["compare architectural tradeoffs and commit to a decision", "reasoning"]] as const)("routes %s as %s", (prompt, tier) => expect(fallbackTier(prompt)).toBe(tier));
 it("inherits complexity signals from prior context", () => expect(fallbackTier("please fix it", "Investigate the root cause across multiple systems")).toBe("complex"));
 it("keeps bounded prior human turns and excludes custom/tool entries", () => { const config = { classifier: { contextTurns: 2, contextCharsPerTurn: 5 } } as any; expect(priorHumanContext([{ type: "message", message: { role: "user", content: "first" } }, { type: "custom", data: "ignore" }, { type: "message", message: { role: "tool", content: "tool" } }, { type: "message", message: { role: "user", content: "second turn" } }, { type: "message", message: { role: "user", content: "latest" } }], config)).toBe("secon\nlat est".replace("lat est", "lates")); });
 it("rejects malformed structured output", () => { expect(parseTier({ tier: "expensive" })).toBeUndefined(); expect(parseTier({ tier: "medium" })).toBe("medium"); });
 it("falls back when a completed classifier call has no tier", () => { expect(resolveClassifierTier({ tier: "unknown" }, "please investigate the root cause across systems", "")).toBe("complex"); });
});
describe("auto-model config", () => {
 it("merges fixed tier overrides", () => { const config = mergeConfig({ enabled: true, tiers: { simple: "a/s" } }, { classifier: { type: "heuristic" } }); expect(config.enabled).toBe(true); expect(config.tiers.simple).toBe("a/s"); expect(config.classifier.type).toBe("heuristic"); expect(config.tiers.medium).toBe(DEFAULT_CONFIG.tiers.medium); });
 it("accepts only known config fields", () => { expect(validateOverride({ enabled: true, tiers: { simple: "p/m", invented: "x" }, classifier: { type: "llm", timeoutMs: -1 } })).toEqual({ enabled: true, tiers: { simple: "p/m" }, classifier: { type: "llm" } }); });
 it("uses host-resolved global and project configuration roots", () => { const paths = configPaths("/project"); expect(paths.global).toMatch(/extensions[\\/]auto-model[\\/]config\.json$/); expect(paths.project).toMatch(/\/project\/\.selesai\/extensions\/auto-model\/config\.json$/); });
 it("updates only the target layer fields", async () => { const path = `/tmp/auto-model-${Date.now()}.json`; await updateConfig(path, { tiers: { simple: "p/s" } }); await updateConfig(path, { enabled: true }); const saved = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")); expect(saved).toEqual({ tiers: { simple: "p/s" }, enabled: true }); });
 it("rejects malformed existing config without overwriting it", async () => { const fs = await import("node:fs/promises"); const path = `/tmp/auto-model-malformed-${Date.now()}.json`; const bytes = "{ malformed config\n"; await fs.writeFile(path, bytes, "utf8"); await expect(updateConfig(path, { enabled: true })).rejects.toThrow(); expect(await fs.readFile(path, "utf8")).toBe(bytes); await fs.rm(path); });
});
