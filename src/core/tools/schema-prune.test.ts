import { describe, expect, it } from "vitest";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { SettingsManager } from "../settings-manager.ts";
import { stripSchemaDescriptions, stripToolParameterDescriptions } from "./schema-prune.ts";

describe("stripSchemaDescriptions", () => {
	it("removes description keys at all depths (properties, anyOf arrays, items)", () => {
		const schema = {
			type: "object",
			description: "root",
			properties: {
				name: { type: "string", description: "the name" },
				tags: {
					type: "array",
					description: "the tags",
					items: { type: "string", description: "a tag" },
				},
				choice: {
					anyOf: [{ type: "string", description: "string branch" }, { type: "number" }],
				},
			},
		};

		const stripped = stripSchemaDescriptions(schema) as typeof schema;

		expect("description" in stripped).toBe(false);
		expect("description" in stripped.properties).toBe(false);
		expect("description" in stripped.properties.tags).toBe(false);
		expect("description" in stripped.properties.tags.items).toBe(false);
		expect("description" in stripped.properties.choice.anyOf[0]).toBe(false);
	});

	it("preserves non-description keys such as type, enum, required, minimum, additionalProperties", () => {
		const schema = {
			type: "object",
			properties: {
				level: { type: "string", enum: ["a", "b"], description: "level desc" },
				count: { type: "integer", minimum: 1, description: "count desc" },
			},
			required: ["level"],
			additionalProperties: false,
		};

		const stripped = stripSchemaDescriptions(schema) as typeof schema;

		expect(stripped).toEqual({
			type: "object",
			properties: {
				level: { type: "string", enum: ["a", "b"] },
				count: { type: "integer", minimum: 1 },
			},
			required: ["level"],
			additionalProperties: false,
		});
	});

	it("never mutates the input schema", () => {
		const schema = {
			type: "object",
			properties: { name: { type: "string", description: "the name" } },
		};
		const snapshot = structuredClone(schema);

		stripSchemaDescriptions(schema);

		expect(schema).toEqual(snapshot);
		expect(schema.properties.name.description).toBe("the name");
	});

	it("memoizes stripped clones per original root", () => {
		const schema = {
			type: "object",
			properties: { name: { type: "string", description: "the name" } },
		};

		const first = stripSchemaDescriptions(schema);
		const second = stripSchemaDescriptions(schema);

		expect(first).toBe(second);
	});

	it("keeps real TypeBox schemas valid after stripping (symbols survive)", () => {
		const schema = Type.Object({
			name: Type.String({ description: "the name" }),
			age: Type.Optional(Type.Integer({ minimum: 0, description: "the age" })),
		});

		const stripped = stripSchemaDescriptions(schema);

		expect(Value.Check(schema, { name: "pi", age: 3 })).toBe(true);
		expect(Value.Check(stripped, { name: "pi", age: 3 })).toBe(true);
		expect(Value.Check(stripped, { name: "pi", age: -1 })).toBe(false);
	});
});

describe("stripToolParameterDescriptions", () => {
	it("keeps the tool description and name while stripping parameter descriptions", () => {
		const tool = {
			name: "read",
			label: "Read",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: { path: { type: "string", description: "file path" } },
			},
			execute: () => Promise.resolve({ content: [], details: {} }),
		} as unknown as AgentTool<any>;

		const stripped = stripToolParameterDescriptions(tool);

		expect(stripped).not.toBe(tool);
		expect(stripped.name).toBe("read");
		expect(stripped.description).toBe("Read a file");
		expect("description" in (stripped.parameters as { properties: { path: object } }).properties.path).toBe(false);
		// Original tool is untouched.
		expect("description" in (tool.parameters as { properties: { path: { description?: string } } }).properties.path).toBe(true);
	});
});

describe("pruneToolDescriptions setting", () => {
	it("defaults to true", () => {
		const manager = SettingsManager.inMemory();
		expect(manager.getPruneToolDescriptions()).toBe(true);
	});

	it("respects explicit true and false", () => {
		expect(SettingsManager.inMemory({ pruneToolDescriptions: true }).getPruneToolDescriptions()).toBe(true);
		expect(SettingsManager.inMemory({ pruneToolDescriptions: false }).getPruneToolDescriptions()).toBe(false);
	});
});
