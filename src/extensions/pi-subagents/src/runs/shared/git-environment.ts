// ponytail: this static list can lag Git additions; refresh from `git rev-parse --local-env-vars` and indexed config keys when Git changes.
const GIT_ROUTING_VARIABLES = new Set([
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_CONFIG",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_DIR",
	"GIT_GRAFT_FILE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_NAMESPACE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_OBJECT_DIRECTORY",
	"GIT_PREFIX",
	"GIT_REPLACE_REF_BASE",
	"GIT_SHALLOW_FILE",
	"GIT_WORK_TREE",
]);

function isGitRoutingVariable(name: string): boolean {
	const upper = name.toUpperCase();
	return GIT_ROUTING_VARIABLES.has(upper) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(upper);
}

/** Remove inherited values that can route Git commands away from the child cwd. */
export function omitGitRoutingEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([name]) => !isGitRoutingVariable(name)));
}
