import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const source = path.resolve("src/extensions");
const target = path.resolve("dist/extensions");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, {
	recursive: true,
	filter(entry) {
		const relative = path.relative(source, entry);
		return !relative.split(/[\\/]+/).includes("node_modules")
			&& !relative.split(/[\\/]+/).includes(".git");
	},
});
