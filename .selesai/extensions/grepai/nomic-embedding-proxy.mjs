#!/usr/bin/env node
/**
 * nomic-embedding-proxy.mjs
 *
 * A dependency-free local HTTP proxy that exposes Nomic embeddings through an
 * OpenAI-compatible API. Accepts POST /v1/embeddings and POST /embeddings and
 * forwards them to the Nomic API, translating OpenAI `input`/`dimensions` into
 * Nomic `texts`/`dimensionality`. Input arrays are sent as sequential batches
 * of at most MAX_BATCH_SIZE texts and the results are aggregated into one
 * OpenAI response. If any upstream batch fails, that upstream error is
 * returned instead of partial data. Binds to 127.0.0.1 only.
 *
 * Usage:
 *   export NOMIC_API_KEY=your_nomic_api_key   # required; read from env only
 *   npm run nomic-proxy                       # listens on http://127.0.0.1:8787
 *   npm run nomic-proxy -- --port 9000        # optional port override
 *
 * Optional environment:
 *   NOMIC_TASK_TYPE=search_document           # passed through as Nomic task_type
 *                                             # (omitted entirely when unset)
 *
 * grepai configuration:
 *   embedder:
 *     provider: openai
 *     endpoint: http://127.0.0.1:8787/v1
 *     model: nomic-embed-text-v1.5
 *     dimensions: 768
 *
 * The model defaults to nomic-embed-text-v1.5 (nomic-embed-code currently
 * returns 503 upstream). Nomic's native API uses `texts` and `dimensionality`,
 * not `input` and `dimensions`.
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_MODEL = "nomic-embed-text-v1.5";
export const DEFAULT_ENDPOINT = "https://api-atlas.nomic.ai/v1/embedding/text";

/** Embedding requests are sent upstream in batches of at most this many texts. */
export const MAX_BATCH_SIZE = 100;

const EMBEDDINGS_PATHS = new Set(["/embeddings", "/v1/embeddings"]);

function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
	});
	res.end(body);
}

function sendError(res, status, message, type = "invalid_request_error") {
	sendJson(res, status, { error: { message, type } });
}

async function readJsonBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function truncate(text, max = 500) {
	const value = typeof text === "string" && text.trim() ? text.trim() : "(no response body)";
	return value.length > max ? `${value.slice(0, max)}...` : value;
}

/**
 * Normalize the OpenAI-style `input` field into a Nomic `texts` array.
 * Throws an Error describing the problem on malformed input.
 */
export function normalizeInput(body) {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new Error("request body must be a JSON object");
	}
	const { input } = body;
	if (typeof input === "string") return [input];
	if (Array.isArray(input)) {
		if (input.length === 0) throw new Error("input array must not be empty");
		if (!input.every((item) => typeof item === "string")) {
			throw new Error("input array must contain only strings");
		}
		return input;
	}
	throw new Error("input must be a string or an array of strings");
}

/**
 * Split a texts array into sequential batches of at most `maxBatchSize` texts.
 */
export function splitTextsIntoBatches(texts, maxBatchSize = MAX_BATCH_SIZE) {
	if (!Array.isArray(texts)) throw new Error("texts must be an array");
	if (!Number.isInteger(maxBatchSize) || maxBatchSize <= 0) {
		throw new Error("maxBatchSize must be a positive integer");
	}
	const batches = [];
	for (let i = 0; i < texts.length; i += maxBatchSize) {
		batches.push(texts.slice(i, i + maxBatchSize));
	}
	return batches;
}

/**
 * Translate an OpenAI-style request body into a Nomic /v1/embedding/text body.
 * `dimensions` becomes `dimensionality`; `task_type` is included only when
 * NOMIC_TASK_TYPE is set.
 */
export function buildNomicBody(body, env = process.env) {
	const texts = normalizeInput(body);
	const model = typeof body.model === "string" && body.model.length > 0 ? body.model : DEFAULT_MODEL;
	const nomic = { model, texts };
	if (body.dimensions !== undefined && body.dimensions !== null) {
		if (typeof body.dimensions !== "number" || !Number.isInteger(body.dimensions) || body.dimensions <= 0) {
			throw new Error("dimensions must be a positive integer");
		}
		nomic.dimensionality = body.dimensions;
	}
	if (env.NOMIC_TASK_TYPE) nomic.task_type = env.NOMIC_TASK_TYPE;
	return nomic;
}

/**
 * Map a Nomic /v1/embedding/text response into the OpenAI embeddings shape.
 */
export function mapNomicToOpenAI(nomic, requestedModel) {
	if (typeof nomic !== "object" || nomic === null || !Array.isArray(nomic.embeddings)) {
		throw new Error("missing embeddings array");
	}
	const data = nomic.embeddings.map((embedding, index) => {
		if (!Array.isArray(embedding)) throw new Error(`embeddings[${index}] is not an array`);
		return { object: "embedding", index, embedding };
	});
	const usage = typeof nomic.usage === "object" && nomic.usage !== null ? nomic.usage : {};
	return {
		object: "list",
		data,
		model: typeof nomic.model === "string" && nomic.model ? nomic.model : requestedModel,
		usage: {
			prompt_tokens: Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : 0,
			total_tokens: Number.isInteger(usage.total_tokens) ? usage.total_tokens : 0,
		},
	};
}

/**
 * Merge per-batch OpenAI responses into one: data keeps global embedding
 * indexes across batches and usage token counts are summed.
 */
export function mergeOpenAIResponses(responses, requestedModel) {
	const data = [];
	let promptTokens = 0;
	let totalTokens = 0;
	let model = requestedModel;
	for (const response of responses) {
		const offset = data.length;
		for (const item of response.data) {
			data.push({ ...item, index: offset + item.index });
		}
		promptTokens += response.usage.prompt_tokens;
		totalTokens += response.usage.total_tokens;
		if (typeof response.model === "string" && response.model) model = response.model;
	}
	return {
		object: "list",
		data,
		model,
		usage: { prompt_tokens: promptTokens, total_tokens: totalTokens },
	};
}

/**
 * Build the request handler. Dependencies (fetch, env) are injectable for tests.
 */
export function createProxyHandler({
	fetchImpl = globalThis.fetch,
	getEnv = () => process.env,
	endpoint = DEFAULT_ENDPOINT,
} = {}) {
	return async function proxyHandler(req, res) {
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? DEFAULT_HOST}`);
		if (req.method !== "POST" || !EMBEDDINGS_PATHS.has(url.pathname)) {
			sendError(res, 404, `Not found: ${req.method} ${url.pathname}`);
			return;
		}

		let body;
		try {
			body = await readJsonBody(req);
		} catch {
			sendError(res, 400, "request body must be valid JSON");
			return;
		}

		const env = getEnv();
		if (!env.NOMIC_API_KEY) {
			sendError(res, 500, "NOMIC_API_KEY environment variable is not set", "server_error");
			return;
		}

		let nomicBody;
		try {
			nomicBody = buildNomicBody(body, env);
		} catch (err) {
			sendError(res, 400, err.message);
			return;
		}

		const openaiBatches = [];
		for (const texts of splitTextsIntoBatches(nomicBody.texts)) {
			const batchBody = { ...nomicBody, texts };

			let upstream;
			try {
				upstream = await fetchImpl(endpoint, {
					method: "POST",
					headers: {
						authorization: `Bearer ${env.NOMIC_API_KEY}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(batchBody),
				});
			} catch (err) {
				sendError(res, 502, `failed to reach Nomic API: ${err.message}`, "upstream_error");
				return;
			}

			const upstreamText = await upstream.text().catch(() => "");
			if (!upstream.ok) {
				sendError(
					res,
					upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502,
					`Nomic API error (${upstream.status}): ${truncate(upstreamText)}`,
					"upstream_error",
				);
				return;
			}

			let nomic;
			try {
				nomic = JSON.parse(upstreamText);
			} catch {
				sendError(res, 502, "Nomic API returned a non-JSON response", "upstream_error");
				return;
			}

			let openai;
			try {
				openai = mapNomicToOpenAI(nomic, batchBody.model);
			} catch (err) {
				sendError(res, 502, `unexpected Nomic API response: ${err.message}`, "upstream_error");
				return;
			}
			openaiBatches.push(openai);
		}

		sendJson(res, 200, mergeOpenAIResponses(openaiBatches, nomicBody.model));
	};
}

export function createProxyServer(options = {}) {
	return createServer(createProxyHandler(options));
}

export async function startProxy({ port = DEFAULT_PORT, host = DEFAULT_HOST, ...options } = {}) {
	const server = createProxyServer(options);
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, resolve);
	});
	console.log(`nomic-embedding-proxy listening on http://${host}:${port} (model ${DEFAULT_MODEL})`);
	return server;
}

const USAGE = `nomic-embedding-proxy - OpenAI-compatible local proxy for Nomic embeddings

Usage:
  NOMIC_API_KEY=<key> npm run nomic-proxy [-- --port <port>]
  npm run nomic-proxy -- --help

Options:
  --port <port>   Port to listen on (default ${DEFAULT_PORT}); also PORT env.
  --help, -h      Show this help.

Environment:
  NOMIC_API_KEY     Required. Nomic API key (read from the environment only).
  NOMIC_TASK_TYPE   Optional. Passed to Nomic as task_type; omitted when unset.

grepai config:
  embedder:
    provider: openai
    endpoint: http://127.0.0.1:${DEFAULT_PORT}/v1
    model: ${DEFAULT_MODEL}
    dimensions: 768`;

function parseArgs(argv) {
	const args = { port: null, help: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--port") {
			const value = Number(argv[++i]);
			if (!Number.isInteger(value) || value <= 0 || value > 65535) {
				throw new Error("--port must be a valid port number (1-65535)");
			}
			args.port = value;
		} else if (argv[i] === "--help" || argv[i] === "-h") {
			args.help = true;
		} else {
			throw new Error(`unknown argument: ${argv[i]}`);
		}
	}
	return args;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		if (args.help) {
			console.log(USAGE);
			process.exit(0);
		}
		const rawPort = process.env.PORT ?? args.port ?? DEFAULT_PORT;
		const port = Number(rawPort);
		if (!Number.isInteger(port) || port <= 0 || port > 65535) {
			throw new Error(`invalid port: ${rawPort}`);
		}
		if (!process.env.NOMIC_API_KEY) {
			console.error("nomic-embedding-proxy: NOMIC_API_KEY environment variable is not set");
			process.exit(1);
		}
		await startProxy({ port });
	} catch (err) {
		console.error(`nomic-embedding-proxy: ${err.message}`);
		process.exit(1);
	}
}
