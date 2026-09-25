import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { omitGitRoutingEnv } from "../../src/runs/shared/git-environment.ts";

const GIT_ROUTING_ENV = {
	GIT_ALTERNATE_OBJECT_DIRECTORIES: "/repo/objects",
	GIT_COMMON_DIR: "/repo/common",
	GIT_CONFIG: "/repo/config",
	GIT_CONFIG_COUNT: "1",
	GIT_CONFIG_KEY_0: "core.worktree",
	GIT_CONFIG_PARAMETERS: "'core.worktree=/repo'",
	GIT_CONFIG_VALUE_0: "/repo",
	GIT_DIR: "/repo/.git",
	GIT_GRAFT_FILE: "/repo/grafts",
	GIT_IMPLICIT_WORK_TREE: "1",
	GIT_INDEX_FILE: "/repo/index",
	GIT_NAMESPACE: "tenant",
	GIT_NO_REPLACE_OBJECTS: "1",
	GIT_OBJECT_DIRECTORY: "/repo/object-dir",
	GIT_PREFIX: "src/",
	GIT_REPLACE_REF_BASE: "refs/replace/",
	GIT_SHALLOW_FILE: "/repo/shallow",
	GIT_WORK_TREE: "/repo",
};

describe("omitGitRoutingEnv", () => {
	it("removes inherited repository routing and keeps unrelated values", () => {
		assert.deepEqual(omitGitRoutingEnv({ ...GIT_ROUTING_ENV, KEEP_ME: "yes" }), { KEEP_ME: "yes" });
	});

	it("removes every indexed Git config entry", () => {
		assert.deepEqual(omitGitRoutingEnv({ GIT_CONFIG_KEY_17: "user.name", GIT_CONFIG_VALUE_17: "Test", KEEP_ME: "yes" }), { KEEP_ME: "yes" });
	});

	it("matches names case-insensitively, as Windows and Git for Windows do", () => {
		assert.deepEqual(omitGitRoutingEnv({ git_dir: "/repo/.git", Git_Work_Tree: "/repo", git_config_key_0: "core.bare", KEEP_ME: "yes" }), { KEEP_ME: "yes" });
	});
});
