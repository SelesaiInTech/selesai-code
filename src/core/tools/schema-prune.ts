import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";

// Memoized stripped clones, keyed by the original schema root. The input is
// never mutated; repeat calls return the same cached clone.
const strippedSchemaCache = new WeakMap<object, object>();

/**
 * Structural deep clone that omits every `description` key at any depth while
 * preserving all other own keys (including TypeBox internals such as `~kind`
 * and `~optional` symbols and function-valued keys). Uses Reflect.ownKeys +
 * property descriptors so non-enumerable metadata survives; never mutates the
 * input.
 */
export function stripSchemaDescriptions<T>(value: T): T {
	if (!value || typeof value !== "object") return value;
	const cached = strippedSchemaCache.get(value);
	if (cached !== undefined) return cached as T;

	const result: object = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor) continue;
		if (key === "description") continue;
		if ("value" in descriptor) {
			descriptor.value = stripSchemaDescriptions(descriptor.value);
		}
		Object.defineProperty(result, key, descriptor);
	}
	strippedSchemaCache.set(value, result);
	return result as T;
}

/**
 * Returns a shallow copy of the tool with its parameter schema descriptions
 * stripped. Top-level tool fields (name, description, execute, ...) are
 * untouched.
 */
export function stripToolParameterDescriptions<T extends TSchema>(tool: AgentTool<T>): AgentTool<T> {
	return { ...tool, parameters: stripSchemaDescriptions(tool.parameters) as T };
}
