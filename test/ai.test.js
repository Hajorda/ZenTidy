// AI providers against a fake fetch: checks the exact request and every error path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGlobals } from "./load.js";

const ctx = loadGlobals(["ai.uc.js"]);
const AI = ctx.ZTAI;
const schema = { type: "object", properties: { groups: { type: "array" } }, required: ["groups"], additionalProperties: false };

// A fetch that records calls and replies from a queue.
function fakeFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

const base = { system: "sys", user: "tabs", schema };

test("anthropic: request shape, structured output and fallback", async () => {
  const f = fakeFetch({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"groups":[]}' }] } });
  const out = await AI.requestJson({ ...base, provider: "anthropic", apiKey: "sk-test", fetchFn: f });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { groups: [] });
  const [c] = f.calls;
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.headers["x-api-key"], "sk-test");
  assert.equal(c.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(c.body.model, "claude-opus-5-5");
  assert.equal(c.body.fallbacks, "default");
  assert.equal(c.body.system, "sys");
  assert.deepEqual(c.body.output_config.format, { type: "json_schema", schema });
  assert.equal(c.body.output_config.effort, "low");
  assert.equal(c.body.thinking, undefined, "thinking left at the model default");
});

test("anthropic: no fallback parameter for models that don't take it", async () => {
  const f = fakeFetch({ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] } });
  await AI.requestJson({ ...base, provider: "anthropic", apiKey: "k", model: "claude-haiku-4-5", fetchFn: f });
  assert.equal(f.calls[0].body.fallbacks, undefined);
  assert.equal(f.calls[0].headers["anthropic-beta"], undefined);
});

test("anthropic: refusal, truncation and HTTP errors become typed errors", async () => {
  const cases = [
    [{ status: 200, body: { stop_reason: "refusal", stop_details: { explanation: "no" }, content: [] } }, "refusal"],
    [{ status: 200, body: { stop_reason: "max_tokens", content: [{ type: "text", text: '{"gro' }] } }, "truncated"],
    [{ status: 401, body: { error: { message: "invalid x-api-key" } } }, "auth"],
    [{ status: 429, body: { error: { message: "slow down" } } }, "rate-limit"],
    [{ status: 529, body: { error: { message: "overloaded" } } }, "server"],
    [{ status: 400, body: { error: { message: "bad" } } }, "bad-request"],
    [new TypeError("NetworkError"), "network"],
    [{ status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] } }, "parse"],
  ];
  for (const [reply, code] of cases) {
    await assert.rejects(
      AI.requestJson({ ...base, provider: "anthropic", apiKey: "k", fetchFn: fakeFetch(reply) }),
      (e) => e.code === code,
      code,
    );
  }
});

test("missing key or model is reported before any request", async () => {
  const f = fakeFetch();
  await assert.rejects(AI.requestJson({ ...base, provider: "anthropic", fetchFn: f }), (e) => e.code === "auth");
  await assert.rejects(AI.requestJson({ ...base, provider: "openai", apiKey: "k", fetchFn: f }), (e) => e.code === "bad-request");
  assert.equal(f.calls.length, 0);
});

test("openai-compatible: json_schema first, json_object if unsupported", async () => {
  const f = fakeFetch(
    { status: 400, body: { error: { message: "response_format json_schema not supported" } } },
    { status: 200, body: { choices: [{ finish_reason: "stop", message: { content: '```json\n{"groups":[1]}\n```' } }] } },
  );
  const out = await AI.requestJson({ ...base, provider: "openai", apiKey: "k", model: "my-model", baseUrl: "https://llm.example/v1/", fetchFn: f });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), { groups: [1] });
  assert.equal(f.calls[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(f.calls[0].headers.authorization, "Bearer k");
  assert.equal(f.calls[0].body.response_format.type, "json_schema");
  assert.equal(f.calls[1].body.response_format.type, "json_object");
});

test("ollama: local, no key, schema as format", async () => {
  const f = fakeFetch({ status: 200, body: { message: { content: '{"groups":[]}' } } });
  await AI.requestJson({ ...base, provider: "ollama", fetchFn: f });
  assert.equal(f.calls[0].url, "http://localhost:11434/api/chat");
  assert.equal(f.calls[0].body.model, "llama3.2");
  assert.equal(f.calls[0].body.stream, false);
  assert.deepEqual(f.calls[0].body.format, schema);
});

test("timeouts abort the request", async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  await assert.rejects(AI.requestJson({ ...base, provider: "ollama", fetchFn: hang, timeoutMs: 50 }), (e) => e.code === "timeout");
});
