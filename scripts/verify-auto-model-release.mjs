import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8"));
const changelog = readFileSync("CHANGELOG.md", "utf8");

if (packageJson.version !== "0.9.15" || lockfile.version !== "0.9.15") {
	throw new Error("Expected package.json and package-lock.json version 0.9.15.");
}
if (!changelog.includes("## [0.9.15]") || !changelog.includes("automatic model routing")) {
	throw new Error("Expected 0.9.15 automatic model routing changelog entry.");
}
console.log("release metadata passed");
