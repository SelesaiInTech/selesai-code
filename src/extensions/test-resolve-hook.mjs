// Register ESM resolve hook to rewrite "@selesai/code" -> this repo's src.
// Node 24 loads .ts natively (no jiti), so we need a real resolve hook.
// Usage: node --import ./src/extensions/test-resolve-hook.mjs --test <file>
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL("./src/extensions/test-resolve-hook-impl.mjs").href);