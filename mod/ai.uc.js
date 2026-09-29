// Zen Tidy — optional AI providers. Each returns the parsed JSON object the
// model produced for the given schema. Uses plain fetch (no SDK can load in
// a userscript).
// eslint-disable-next-line no-var
var ZTAI = (() => {
  "use strict";

  class AIError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code; // auth | rate-limit | server | bad-request | refusal | truncated | network | timeout | parse
    }
  }

  const PROVIDERS = {
    anthropic: { label: "Claude (Anthropic)", defaultModel: "claude-opus-5-5", needsKey: true, baseUrl: "https://api.anthropic.com" },
    openai: { label: "OpenAI-compatible", defaultModel: "", needsKey: true, baseUrl: "https://api.openai.com/v1" },
    ollama: { label: "Ollama (local)", defaultModel: "llama3.2", needsKey: false, baseUrl: "http://localhost:11434" },
  };

  // Models that accept the server-side refusal fallback parameter.
  const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

  function statusError(status, body) {
    const msg = body?.error?.message || body?.error || body?.message || `HTTP ${status}`;
    const text = typeof msg === "string" ? msg : JSON.stringify(msg);
    if (status === 401 || status === 403) return new AIError("auth", text);
    if (status === 429) return new AIError("rate-limit", text);
    if (status >= 500) return new AIError("server", text);
    return new AIError("bad-request", text);
  }

  async function post(fetchFn, url, headers, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      throw new AIError(e?.name === "AbortError" ? "timeout" : "network", String(e?.message || e));
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await res.json();
    } catch { /* non-JSON error page */ }
    if (!res.ok) throw statusError(res.status, data);
    return data;
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      // Some local models wrap JSON in prose or code fences.
      const m = String(text || "").match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch { /* fall through */ }
      }
      throw new AIError("parse", "The model did not return valid JSON");
    }
  }

  async function anthropic({ fetchFn, apiKey, model, baseUrl, system, user, schema, timeoutMs }) {
    const headers = {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    const body = {
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    };
    // If Claude declines, let the API re-run the request on a fallback model.
    if (FALLBACK_MODELS.has(model)) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
    }
    const data = await post(fetchFn, `${baseUrl}/v1/messages`, headers, body, timeoutMs);
    if (data.stop_reason === "refusal") throw new AIError("refusal", data.stop_details?.explanation || "The model declined this request");
    if (data.stop_reason === "max_tokens") throw new AIError("truncated", "The response was cut off (too many tabs?)");
    const text = (data.content || []).find((b) => b.type === "text")?.text;
    if (!text) throw new AIError("parse", "No text in the response");
    return parseJson(text);
  }

  async function openai({ fetchFn, apiKey, model, baseUrl, system, user, schema, timeoutMs }) {
    const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
    const messages = [{ role: "system", content: system }, { role: "user", content: user }];
    const call = (response_format) => post(fetchFn, `${baseUrl}/chat/completions`, headers, { model, messages, response_format }, timeoutMs);
    let data;
    try {
      data = await call({ type: "json_schema", json_schema: { name: "result", schema, strict: true } });
    } catch (e) {
      // Older or third-party servers may only support plain JSON mode.
      if (e.code !== "bad-request") throw e;
      data = await call({ type: "json_object" });
    }
    const choice = data.choices?.[0];
    if (choice?.finish_reason === "length") throw new AIError("truncated", "The response was cut off (too many tabs?)");
    if (choice?.message?.refusal) throw new AIError("refusal", choice.message.refusal);
    return parseJson(choice?.message?.content);
  }

  async function ollama({ fetchFn, model, baseUrl, system, user, schema, timeoutMs }) {
    const body = {
      model,
      stream: false,
      format: schema,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    const data = await post(fetchFn, `${baseUrl}/api/chat`, {}, body, timeoutMs);
    return parseJson(data?.message?.content);
  }

  // opts: { provider, model?, baseUrl?, apiKey?, system, user, schema, fetchFn?, timeoutMs? }
  async function requestJson(opts) {
    const p = PROVIDERS[opts.provider];
    if (!p) throw new AIError("bad-request", `Unknown AI provider "${opts.provider}"`);
    if (p.needsKey && !opts.apiKey) throw new AIError("auth", `No API key set for ${p.label}`);
    if (!(opts.model || p.defaultModel)) throw new AIError("bad-request", `Set a model name for ${p.label} in Zen Tidy's settings`);
    const args = {
      fetchFn: opts.fetchFn || fetch,
      timeoutMs: opts.timeoutMs || 60_000,
      model: opts.model || p.defaultModel,
      baseUrl: (opts.baseUrl || p.baseUrl).replace(/\/+$/, ""),
      apiKey: opts.apiKey,
      system: opts.system,
      user: opts.user,
      schema: opts.schema,
    };
    if (opts.provider === "anthropic") return anthropic(args);
    if (opts.provider === "openai") return openai(args);
    return ollama(args);
  }

  return { PROVIDERS, AIError, requestJson };
})();
