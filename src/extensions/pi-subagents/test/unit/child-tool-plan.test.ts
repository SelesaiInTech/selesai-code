import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { resolvePiLaunchToolPlan } from "../../src/runs/shared/child-tool-plan.ts";
import { MCP_RUNTIME_SNAPSHOT_EVENT, MCP_RUNTIME_SNAPSHOT_VERSION, type McpRuntimeSnapshotHost } from "../../src/runs/shared/mcp-direct-tool-allowlist.ts";

/** A parent whose pi-mcp-adapter answers snapshot requests for one runtime-only server. */
function runtimeSnapshotHost(serverName: string): McpRuntimeSnapshotHost {
	return {
		events: {
			emit(event, request) {
				if (event !== MCP_RUNTIME_SNAPSHOT_EVENT || request.version !== MCP_RUNTIME_SNAPSHOT_VERSION || request.name !== serverName) return;
				request.result = { ok: true, snapshot: { name: serverName, runtime: true, persisted: false, definition: { command: "node", args: ["server.js"] } } };
			},
		},
	};
}

describe("child tool plan", () => {
	it("requires fanout authorization for the child supervisor reply tool", () => {
		assert.throws(() => resolvePiLaunchToolPlan({ tools: ["read", "subagent_supervisor"] }), /subagent_supervisor.*requires fanout authorization/);
		assert.throws(() => resolvePiLaunchToolPlan({ tools: ["read", "subagent", "subagent_supervisor"], excludeTools: ["subagent"] }), /subagent_supervisor.*requires fanout authorization/);
		assert.throws(() => resolvePiLaunchToolPlan({
			tools: ["read", "subagent", "subagent_supervisor"],
			capabilityCeiling: { version: 1, allowedTools: ["read", "subagent_supervisor"], sources: ["test"] },
		}), /subagent_supervisor.*requires fanout authorization/);
		assert.equal(resolvePiLaunchToolPlan({ tools: ["read", "subagent", "subagent_supervisor"] }).fanoutAuthorized, true);
		assert.equal(resolvePiLaunchToolPlan({ tools: ["read", "subagent_supervisor"], allowNestedSubagents: true }).fanoutAuthorized, true);
	});

	it("fails a launch that selects MCP tools from the adapter's runtime snapshot", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-runtime-mcp-"));
		try {
			assert.throws(
				() => resolvePiLaunchToolPlan({ tools: ["read"], mcpDirectTools: ["runtime-only/search"], cwd, agentName: "browser", runtimeSnapshotHost: runtimeSnapshotHost("runtime-only") }),
				/cannot be provided to in-process children; MCP tools must come from an ambient adapter extension in a background child/,
			);
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	});
});
