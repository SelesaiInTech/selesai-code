import { describe, expect, it } from "vitest";
import { buildGitCommandPrompt } from "../src/core/git-command.ts";

describe("git command prompt", () => {
	it("defaults to a safe git status flow", () => {
		const prompt = buildGitCommandPrompt("");
		expect(prompt).toContain("git status --short --branch");
		expect(prompt).toContain("worktrees, checkpoints, restore, or commit/push");
		expect(prompt).toContain("until the user explicitly confirms");
	});

	it("routes worktree requests", () => {
		const prompt = buildGitCommandPrompt("worktree add ../feature feature/foo");
		expect(prompt).toContain("git worktree list");
		expect(prompt).toContain("User request: add ../feature feature/foo");
	});

	it("routes checkpoint aliases", () => {
		const prompt = buildGitCommandPrompt("cp before refactor");
		expect(prompt).toContain("Focus on checkpoints");
		expect(prompt).toContain("User request: before refactor");
	});

	it("routes restore through stash-or-discard confirmation", () => {
		const prompt = buildGitCommandPrompt("restore abc123");
		expect(prompt).toContain("Focus on safe restore");
		expect(prompt).toContain("stash them first (recommended) or discard them");
		expect(prompt).toContain("User request: abc123");
	});
});
