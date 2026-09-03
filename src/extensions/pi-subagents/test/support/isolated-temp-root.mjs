import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const configuredTempRoot = process.env.SELESAI_SUBAGENTS_TEMP_ROOT?.trim();
const tempRoot = configuredTempRoot
	? path.resolve(configuredTempRoot)
	: fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-test-root-"));
process.env.SELESAI_SUBAGENTS_TEMP_ROOT = tempRoot;

const nestedTestProcess = process.env.SELESAI_SUBAGENTS_TEST_LOADER === "1";
const isolatedHome = path.join(tempRoot, "home");
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
if (!nestedTestProcess) delete process.env.SELESAI_CODING_AGENT_DIR;
process.env.SELESAI_SUBAGENTS_TEST_LOADER = "1";

if (!configuredTempRoot) {
	process.on("exit", () => fs.rmSync(tempRoot, { recursive: true, force: true }));
}
