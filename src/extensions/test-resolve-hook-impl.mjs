export async function resolve(specifier, context, next) {
	if (specifier === "@selesai/code" || specifier.startsWith("@selesai/code/")) {
		const url = new URL("../../src/index.ts", import.meta.url);
		return next(url.href, context);
	}
	return next(specifier, context);
}