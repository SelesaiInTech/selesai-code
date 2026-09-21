// Release check: a clean install outside the development tree boots and loads its
// bundled extensions. Run against a package installed from the packed tarball.
//
//   node scripts/verify-clean-install.mjs /path/to/node_modules/@selesai/code
//
// This is the seam a source checkout cannot exercise: a runtime dependency that
// exists in the development tree but not in the package manifest shows up here.
const pkgDir = process.argv[2];
if (!pkgDir) {
	console.error("usage: node scripts/verify-clean-install.mjs <installed @selesai/code dir>");
	process.exit(2);
}
const { discoverAndLoadExtensions } = await import(`${pkgDir}/dist/index.js`);
const { getPackageDir, getAgentDir, getBundledExtensionsDir } = await import(`${pkgDir}/dist/config.js`);

const bundledDir = getBundledExtensionsDir();
const result = await discoverAndLoadExtensions([bundledDir], getPackageDir(), getAgentDir());
const names = (result.extensions ?? []).map((e) => e.name ?? e.path).sort();
const diagnostics = result.diagnostics ?? [];

console.log(`BUNDLED_DIR: ${bundledDir}`);
console.log(`EXTENSION_COUNT: ${names.length}`);
console.log(`EXTENSIONS: ${names.join(" | ")}`);
console.log(`DIAGNOSTICS: ${diagnostics.length}`);

if (diagnostics.length > 0) {
	for (const d of diagnostics) console.error(`  ${d.severity ?? "?"}: ${d.message ?? d}`);
	process.exit(1);
}
if (names.length === 0) {
	console.error("no bundled extensions loaded");
	process.exit(1);
}
console.log("CLEAN_INSTALL_OK");
