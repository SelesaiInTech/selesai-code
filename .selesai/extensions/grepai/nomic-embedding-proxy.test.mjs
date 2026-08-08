import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, test } from "node:test";
import {
	buildNomicBody,
	createProxyHandler,
	DEFAULT_ENDPOINT,
	DEFAULT_MODEL,
	mapNomicToOpenAI,
	MAX_BATCH_SIZE,
	mergeOpenAIResponses,
	splitTextsIntoBatches,
} from "./nomic-embedding-proxy.mjs";

const API_KEY = "test-nomic-key";
const NOMIC_EMBEDDINGS = [
	[0.1, 0.2, 0.3],
	[0.4, 0.5, 0.6],
];
const NOMIC_RESPONSE = {
	embeddings: NOMIC_EMBEDDINGS,
	model: "nomic-embed-text-v1.5",
	usage: { prompt_tokens: 7, total_tokens: 7 },
};

/** Stub fetch that records upstream calls and returns a canned Nomic response. */
function nomicFetchStub({ status = 200, body = NOMIC_RESPONSE } = {}) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, init, nomicBody: JSON.parse(init.body) });
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
	return { calls, impl };
}

/** Stub fetch that echoes one embedding per text and usage equal to the batch size. */
function nomicBatchFetchStub() {
	const calls = [];
	let offset = 0;
	const impl = async (url, init) => {
		const nomicBody = JSON.parse(init.body);
		calls.push({ url, init, nomicBody });
		const embeddings = nomicBody.texts.map((text, i) => [text.length, offset + i]);
		offset += nomicBody.texts.length;
		return new Response(
			JSON.stringify({
				embeddings,
				model: "nomic-embed-text-v1.5",
				usage: { prompt_tokens: nomicBody.texts.length, total_tokens: nomicBody.texts.length },
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		);
	};
	return { calls, impl };
}

async function startTestServer(handler) {
	const server = createServer(handler);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address();
	return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function post(baseUrl, path, body, { method = "POST", raw } = {}) {
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: raw ?? JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, json: text ? JSON.parse(text) : null };
}

function makeEnv(overrides = {}) {
	return { NOMIC_API_KEY: API_KEY, ...overrides };
}

describe("buildNomicBody (request translation)", () => {
	test("maps string input to texts and dimensions to dimensionality, defaulting the model", () => {
		const body = buildNomicBody({ input: "hello world", dimensions: 768 }, makeEnv());
		assert.deepEqual(body, { model: DEFAULT_MODEL, texts: ["hello world"], dimensionality: 768 });
	});

	test("maps array input and honors an explicit model", () => {
		const body = buildNomicBody({ input: ["a", "b"], model: "nomic-embed-text-v1.5" }, makeEnv());
		assert.deepEqual(body, { model: "nomic-embed-text-v1.5", texts: ["a", "b"] });
	});

	test("omits task_type unless NOMIC_TASK_TYPE is set", () => {
		const without = buildNomicBody({ input: "x" }, makeEnv());
		assert.equal("task_type" in without, false);
		const withType = buildNomicBody({ input: "x" }, makeEnv({ NOMIC_TASK_TYPE: "search_document" }));
		assert.equal(withType.task_type, "search_document");
	});

	test("rejects malformed input", () => {
		assert.throws(() => buildNomicBody({}, makeEnv()), /input must be a string or an array of strings/);
		assert.throws(() => buildNomicBody({ input: [] }, makeEnv()), /input array must not be empty/);
		assert.throws(() => buildNomicBody({ input: ["ok", 42] }, makeEnv()), /only strings/);
		assert.throws(() => buildNomicBody({ input: "x", dimensions: "768" }, makeEnv()), /dimensions must be a positive integer/);
	});
});

describe("mapNomicToOpenAI (response mapping)", () => {
	test("maps embeddings, model and usage into OpenAI shape", () => {
		const openai = mapNomicToOpenAI(NOMIC_RESPONSE, DEFAULT_MODEL);
		assert.equal(openai.object, "list");
		assert.deepEqual(openai.data, [
			{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
			{ object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] },
		]);
		assert.equal(openai.model, "nomic-embed-text-v1.5");
		assert.deepEqual(openai.usage, { prompt_tokens: 7, total_tokens: 7 });
	});

	test("falls back to the requested model and zero usage when absent", () => {
		const openai = mapNomicToOpenAI({ embeddings: [[0.1]] }, "fallback-model");
		assert.equal(openai.model, "fallback-model");
		assert.deepEqual(openai.usage, { prompt_tokens: 0, total_tokens: 0 });
	});

	test("rejects responses without an embeddings array", () => {
		assert.throws(() => mapNomicToOpenAI({ model: "x" }, DEFAULT_MODEL), /missing embeddings array/);
	});
});

describe("batching (100-text batch cap)", () => {
	test("splitTextsIntoBatches splits at the 100-text maximum", () => {
		const texts = Array.from({ length: 501 }, (_, i) => `t${i}`);
		const batches = splitTextsIntoBatches(texts);
		assert.equal(batches.length, 6);
		assert.equal(batches[0].length, 100);
		assert.equal(batches[1].length, 100);
		assert.equal(batches[5].length, 1);
		assert.equal(batches[5][0], "t500");
		assert.equal(splitTextsIntoBatches(texts.slice(0, 100)).length, 1);
		assert.equal(splitTextsIntoBatches(Array.from({ length: 1000 }, (_, i) => `t${i}`)).length, 10);
		assert.equal(splitTextsIntoBatches(Array.from({ length: 1001 }, (_, i) => `t${i}`)).length, 11);
		assert.equal(MAX_BATCH_SIZE, 100);
	});

	test("mergeOpenAIResponses concatenates data with global indexes and sums usage", () => {
		const merged = mergeOpenAIResponses(
			[
				{
					object: "list",
					data: [{ object: "embedding", index: 0, embedding: [0.1] }],
					model: "nomic-embed-text-v1.5",
					usage: { prompt_tokens: 500, total_tokens: 500 },
				},
				{
					object: "list",
					data: [{ object: "embedding", index: 0, embedding: [0.2] }],
					model: "nomic-embed-text-v1.5",
					usage: { prompt_tokens: 1, total_tokens: 1 },
				},
			],
			DEFAULT_MODEL,
		);
		assert.deepEqual(merged, {
			object: "list",
			data: [
				{ object: "embedding", index: 0, embedding: [0.1] },
				{ object: "embedding", index: 1, embedding: [0.2] },
			],
			model: "nomic-embed-text-v1.5",
			usage: { prompt_tokens: 501, total_tokens: 501 },
		});
	});
});

describe("proxy HTTP handling", () => {
	test("translates a request and maps the response for /v1/embeddings", async () => {
		const stub = nomicFetchStub();
		const handler = createProxyHandler({ fetchImpl: stub.impl, getEnv: () => makeEnv() });
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const { status, json } = await post(baseUrl, "/v1/embeddings", {
				input: "hello world",
				model: "nomic-embed-text-v1.5",
				dimensions: 768,
			});

			assert.equal(status, 200);
			assert.equal(stub.calls.length, 1);
			assert.equal(stub.calls[0].url, DEFAULT_ENDPOINT);
			assert.deepEqual(stub.calls[0].nomicBody, {
				model: "nomic-embed-text-v1.5",
				texts: ["hello world"],
				dimensionality: 768,
			});
			assert.equal(stub.calls[0].init.headers.authorization, `Bearer ${API_KEY}`);
			assert.deepEqual(json, {
				object: "list",
				data: [
					{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
					{ object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] },
				],
				model: "nomic-embed-text-v1.5",
				usage: { prompt_tokens: 7, total_tokens: 7 },
			});
		} finally {
			server.close();
		}
	});

	test("accepts array input on /embeddings and includes task_type when set", async () => {
		const stub = nomicFetchStub();
		const handler = createProxyHandler({
			fetchImpl: stub.impl,
			getEnv: () => makeEnv({ NOMIC_TASK_TYPE: "search_document" }),
		});
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const { status } = await post(baseUrl, "/embeddings", { input: ["alpha", "beta"] });
			assert.equal(status, 200);
			assert.deepEqual(stub.calls[0].nomicBody, {
				model: DEFAULT_MODEL,
				texts: ["alpha", "beta"],
				task_type: "search_document",
			});
		} finally {
			server.close();
		}
	});

	test("returns a clear JSON error when the upstream fails (503)", async () => {
		const stub = nomicFetchStub({ status: 503, body: { detail: "rate limited" } });
		const handler = createProxyHandler({ fetchImpl: stub.impl, getEnv: () => makeEnv() });
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const { status, json } = await post(baseUrl, "/v1/embeddings", { input: "x" });
			assert.equal(status, 503);
			assert.equal(json.error.type, "upstream_error");
			assert.match(json.error.message, /503/);
			assert.match(json.error.message, /rate limited/);
		} finally {
			server.close();
		}
	});

	test("returns 502 when the upstream is unreachable", async () => {
		const handler = createProxyHandler({
			fetchImpl: async () => {
				throw new Error("ECONNREFUSED");
			},
			getEnv: () => makeEnv(),
		});
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const { status, json } = await post(baseUrl, "/v1/embeddings", { input: "x" });
			assert.equal(status, 502);
			assert.equal(json.error.type, "upstream_error");
			assert.match(json.error.message, /ECONNREFUSED/);
		} finally {
			server.close();
		}
	});

	test("returns 500 when NOMIC_API_KEY is missing", async () => {
		const handler = createProxyHandler({ fetchImpl: nomicFetchStub().impl, getEnv: () => ({}) });
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const { status, json } = await post(baseUrl, "/v1/embeddings", { input: "x" });
			assert.equal(status, 500);
			assert.equal(json.error.type, "server_error");
			assert.match(json.error.message, /NOMIC_API_KEY/);
		} finally {
			server.close();
		}
	});

	test("rejects malformed requests with JSON errors", async () => {
		const handler = createProxyHandler({ fetchImpl: nomicFetchStub().impl, getEnv: () => makeEnv() });
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const badJson = await post(baseUrl, "/v1/embeddings", null, { raw: "{not json" });
			assert.equal(badJson.status, 400);
			assert.match(badJson.json.error.message, /valid JSON/);

			const noInput = await post(baseUrl, "/v1/embeddings", { model: DEFAULT_MODEL });
			assert.equal(noInput.status, 400);
			assert.match(noInput.json.error.message, /input must be/);

			const badArray = await post(baseUrl, "/v1/embeddings", { input: ["ok", 7] });
			assert.equal(badArray.status, 400);
			assert.match(badArray.json.error.message, /only strings/);
		} finally {
			server.close();
		}
	});

	test("splits 501 inputs into six upstream calls (100 \u00d7 5 + 1) and aggregates data/usage", async () => {
		const stub = nomicBatchFetchStub();
		const handler = createProxyHandler({ fetchImpl: stub.impl, getEnv: () => makeEnv() });
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const input = Array.from({ length: 501 }, (_, i) => `text-${i}`);
			const { status, json } = await post(baseUrl, "/v1/embeddings", { input, dimensions: 768 });

			assert.equal(status, 200);
			assert.equal(stub.calls.length, 6);
			assert.equal(stub.calls[0].nomicBody.texts.length, 100);
			assert.deepEqual(stub.calls[0].nomicBody.texts[0], "text-0");
			assert.deepEqual(stub.calls[0].nomicBody.texts[99], "text-99");
			assert.equal(stub.calls[0].nomicBody.dimensionality, 768);
			assert.deepEqual(stub.calls[5].nomicBody.texts, ["text-500"]);
			assert.equal(stub.calls[5].nomicBody.dimensionality, 768);
			assert.equal(stub.calls[5].nomicBody.model, DEFAULT_MODEL);

			assert.equal(json.object, "list");
			assert.equal(json.data.length, 501);
			assert.deepEqual(json.data[99], { object: "embedding", index: 99, embedding: ["text-99".length, 99] });
			assert.deepEqual(json.data[500], { object: "embedding", index: 500, embedding: ["text-500".length, 500] });
			assert.equal(json.model, "nomic-embed-text-v1.5");
			assert.deepEqual(json.usage, { prompt_tokens: 501, total_tokens: 501 });
		} finally {
			server.close();
		}
	});

	test("returns the upstream error when a later batch fails, without partial data", async () => {
		const calls = [];
		const impl = async (url, init) => {
			const nomicBody = JSON.parse(init.body);
			calls.push(nomicBody);
			if (calls.length === 2) {
				return new Response(JSON.stringify({ detail: "batch too large" }), {
					status: 413,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(
				JSON.stringify({
					embeddings: nomicBody.texts.map(() => [0.1, 0.2]),
					model: "nomic-embed-text-v1.5",
					usage: { prompt_tokens: nomicBody.texts.length, total_tokens: nomicBody.texts.length },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		};
		const handler = createProxyHandler({ fetchImpl: impl, getEnv: () => makeEnv() });
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const input = Array.from({ length: 501 }, (_, i) => `text-${i}`);
			const { status, json } = await post(baseUrl, "/v1/embeddings", { input });

			assert.equal(status, 413);
			assert.equal(json.error.type, "upstream_error");
			assert.match(json.error.message, /413/);
			assert.match(json.error.message, /batch too large/);
			assert.equal("data" in json, false);
			assert.equal(calls.length, 2); // first batch succeeded, second failed
		} finally {
			server.close();
		}
	});

	test("rejects non-embedding routes and methods with JSON errors", async () => {
		const handler = createProxyHandler({ fetchImpl: nomicFetchStub().impl, getEnv: () => makeEnv() });
		const { server, baseUrl } = await startTestServer(handler);
		try {
			const wrongPath = await post(baseUrl, "/v1/completions", { input: "x" });
			assert.equal(wrongPath.status, 404);
			assert.equal(wrongPath.json.error.type, "invalid_request_error");

			const wrongMethod = await fetch(`${baseUrl}/v1/embeddings`, { method: "GET" });
			const wrongMethodJson = await wrongMethod.json();
			assert.equal(wrongMethod.status, 404);
			assert.equal(wrongMethodJson.error.type, "invalid_request_error");
		} finally {
			server.close();
		}
	});
});
