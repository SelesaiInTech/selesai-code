export interface GitCommandMode {
	name: string;
	aliases: string[];
	description: string;
	instructions: string;
}

export const GIT_COMMAND_MODES: ReadonlyArray<GitCommandMode> = [
	{
		name: "worktree",
		aliases: ["wt", "work-tree", "work tree"],
		description: "Create, list, switch, or clean up git worktrees",
		instructions:
			"Focus on git worktrees. Start with `git worktree list` and `git status --short --branch`. Help create, switch to, or clean up worktrees only after confirming the target branch/path.",
	},
	{
		name: "checkpoint",
		aliases: ["cp", "checkpoints", "save"],
		description: "Save or restore small checkpoint commits",
		instructions:
			"Focus on checkpoints. If saving, inspect the diff, summarize changes, propose a small checkpoint commit message, then wait for confirmation before staging or committing. If restoring, follow the restore flow. Do not push unless asked.",
	},
	{
		name: "restore",
		aliases: ["recover", "rollback"],
		description: "Restore files from a checkpoint or commit safely",
		instructions:
			"Focus on safe restore. Start with `git status --short --branch` and identify the checkpoint/ref. If there are local changes, ask the user to choose: stash them first (recommended) or discard them. Do not restore, stash, discard, reset, or checkout until the user explicitly confirms.",
	},
	{
		name: "push",
		aliases: ["commit", "publish", "sync"],
		description: "Commit, push, pull, and related remote actions",
		instructions:
			"Focus on commit/push workflow. Inspect status, branch, remotes, and recent commits. Propose the minimal commit/push steps, then wait for confirmation before committing, pulling, or pushing.",
	},
];

function parseGitMode(input: string): { mode?: GitCommandMode; rest: string } {
	const trimmed = input.trim();
	if (!trimmed) return { rest: "" };

	const lower = trimmed.toLowerCase();
	for (const mode of GIT_COMMAND_MODES) {
		const names = [mode.name, ...mode.aliases].map((name) => name.toLowerCase());
		const match = names.find((name) => lower === name || lower.startsWith(`${name} `));
		if (match) {
			return { mode, rest: trimmed.slice(match.length).trim() };
		}
	}

	return { rest: trimmed };
}

export function buildGitCommandPrompt(input: string): string {
	const { mode, rest } = parseGitMode(input);
	const requested = rest ? `\nUser request: ${rest}` : "";
	const modeLine = mode
		? mode.instructions
		: "Start by running `git status --short --branch`. Then help the user choose between worktrees, checkpoints, restore, or commit/push actions.";

	return `Git helper for this repository.\n${modeLine}\nSafety: do not discard changes, delete branches/worktrees, reset, force-push, or push anything until the user explicitly confirms.${requested}`;
}
