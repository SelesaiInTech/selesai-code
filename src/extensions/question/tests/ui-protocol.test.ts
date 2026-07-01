import test from "node:test";
import assert from "node:assert/strict";

import { DialogFallback } from "../dialog-adapter.ts";
import type { QuestionResponse, ResolvedQuestionParams } from "../types.ts";
import type { UIProtocol } from "../ui-protocol.ts";

// ---------------------------------------------------------------------------
// Fake UIProtocol — queues return values, captures calls
// ---------------------------------------------------------------------------

function fakeProtocol(overrides: Partial<UIProtocol> = {}): UIProtocol {
	const calls: { method: string; args: any[] }[] = [];
	return {
		hasUI: true,
		theme: { fg: (_n: string, s: string) => s, bold: (s: string) => s } as any,
		custom: async () => undefined,
		select: async (prompt: string, options: string[], opts?: any) => {
			calls.push({ method: "select", args: [prompt, options, opts] });
			return overrides.select?.(prompt, options, opts);
		},
		input: async (prompt: string, placeholder?: string, opts?: any) => {
			calls.push({ method: "input", args: [prompt, placeholder, opts] });
			return overrides.input?.(prompt, placeholder, opts);
		},
		setStatus: () => {},
		notify: () => {},
		...overrides,
	} as UIProtocol;
}

function makeParams(overrides: Partial<ResolvedQuestionParams> = {}): ResolvedQuestionParams {
	return {
		question: "Pick one",
		context: undefined,
		options: [{ label: "Option A" }, { label: "Option B" }],
		allowMultiple: false,
		allowFreeform: false,
		allowComment: false,
		displayMode: "overlay",
		shortcuts: {
			overlayToggle: { disabled: true, spec: null, matches: () => false },
			commentToggle: { disabled: true, spec: null, matches: () => false },
		},
		timeout: undefined,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Single-select dialog fallback
// ---------------------------------------------------------------------------

test("DialogFallback: single-select returns selection", async () => {
	const protocol = fakeProtocol({
		select: async () => "Option A",
	});
	const result = await DialogFallback.ask(makeParams(), protocol);
	assert.deepEqual(result, { kind: "selection", selections: ["Option A"] });
});

test("DialogFallback: single-select + comment", async () => {
	const protocol = fakeProtocol({
		select: async () => "Option A",
		input: async () => "my note",
	});
	const result = await DialogFallback.ask(makeParams({ allowComment: true }), protocol);
	assert.deepEqual(result, {
		kind: "selection",
		selections: ["Option A"],
		comment: "my note",
	});
});

test("DialogFallback: single-select cancel (select returns undefined)", async () => {
	const protocol = fakeProtocol({
		select: async () => undefined,
	});
	const result = await DialogFallback.ask(makeParams(), protocol);
	assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Multi-select dialog fallback
// ---------------------------------------------------------------------------

test("DialogFallback: multi-select returns selections from input", async () => {
	const protocol = fakeProtocol({
		input: async () => "Option A,Option B",
	});
	const result = await DialogFallback.ask(makeParams({ allowMultiple: true }), protocol);
	assert.deepEqual(result, {
		kind: "selection",
		selections: ["Option A", "Option B"],
	});
});

test("DialogFallback: multi-select + comment", async () => {
	let inputCall = 0;
	const protocol = fakeProtocol({
		input: async () => {
			inputCall++;
			return inputCall === 1 ? "Option A" : "extra context";
		},
	});
	const result = await DialogFallback.ask(makeParams({ allowMultiple: true, allowComment: true }), protocol);
	assert.deepEqual(result, {
		kind: "selection",
		selections: ["Option A"],
		comment: "extra context",
	});
});

test("DialogFallback: multi-select cancel (input returns undefined)", async () => {
	const protocol = fakeProtocol({
		input: async () => undefined,
	});
	const result = await DialogFallback.ask(makeParams({ allowMultiple: true }), protocol);
	assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// Freeform dialog fallback
// ---------------------------------------------------------------------------

test("DialogFallback: freeform via select 'custom' option", async () => {
	let selectCall = 0;
	const protocol = fakeProtocol({
		select: async () => "✏️ Type custom response...",
		input: async () => "my custom answer",
	});
	const result = await DialogFallback.ask(makeParams({ allowFreeform: true }), protocol);
	assert.deepEqual(result, { kind: "freeform", text: "my custom answer" });
});

test("DialogFallback: freeform cancel (input returns undefined after selecting custom)", async () => {
	const protocol = fakeProtocol({
		select: async () => "✏️ Type custom response...",
		input: async () => undefined,
	});
	const result = await DialogFallback.ask(makeParams({ allowFreeform: true }), protocol);
	assert.equal(result, null);
});