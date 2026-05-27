/**
 * Evotown OpenClaw plugin — gateway routing + optional policy hooks.
 *
 * Policy enforcement calls POST /api/v1/policy/evaluate on the control plane.
 * Requires EVOTOWN_URL (or OPENAI_BASE_URL without /api/gateway/v1) and evk_/evi_ token.
 */

function evotownBaseUrl() {
  const explicit = (process.env.EVOTOWN_URL || "").replace(/\/$/, "");
  if (explicit) return explicit;
  const openai = (process.env.OPENAI_BASE_URL || "").replace(/\/$/, "");
  if (openai.endsWith("/api/gateway/v1")) {
    return openai.slice(0, -"/api/gateway/v1".length);
  }
  return openai;
}

function evotownToken() {
  return (
    process.env.EVOTOWN_INGEST_TOKEN ||
    process.env.EVOTOWN_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();
}

async function evaluatePolicy({ kind, resource, runId = "", engineId = "", extra = {} }) {
  const base = evotownBaseUrl();
  const token = evotownToken();
  if (!base || !token) {
    return { allowed: true, action: "allowed", hits: [], skipped: "missing EVOTOWN_URL or API key" };
  }
  const res = await fetch(`${base}/api/v1/policy/evaluate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      kind,
      resource,
      run_id: runId,
      engine_id: engineId,
      extra,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.detail || `policy evaluate HTTP ${res.status}`);
  }
  return body;
}

async function enforcePolicy(ctx) {
  const result = await evaluatePolicy(ctx);
  if (result.allowed === false) {
    const msg = (result.hits && result.hits[0] && result.hits[0].message) || "blocked by Evotown policy";
    const err = new Error(msg);
    err.policy = result;
    throw err;
  }
  if (result.action === "warned") {
    console.warn("[evotown-policy]", result.hits?.[0]?.message || "policy warning");
  }
  return result;
}

function registerPolicyHooks(api) {
  const hooks = api?.hooks;
  if (!hooks || typeof hooks.on !== "function") {
    return;
  }

  hooks.on("tool:before", async (event) => {
    const tool =
      event?.tool?.name ||
      event?.toolName ||
      event?.name ||
      (typeof event?.tool === "string" ? event.tool : "");
    if (!tool) return;
    await enforcePolicy({
      kind: "tool",
      resource: String(tool),
      runId: String(event?.runId || event?.run_id || ""),
      engineId: String(process.env.EVOTOWN_ENGINE_ID || ""),
    });
  });

  hooks.on("fs:read", async (event) => {
    const path = event?.path || event?.file || "";
    if (!path) return;
    await enforcePolicy({ kind: "file_read", resource: String(path) });
  });

  hooks.on("fs:write", async (event) => {
    const path = event?.path || event?.file || "";
    if (!path) return;
    await enforcePolicy({ kind: "file_write", resource: String(path) });
  });

  hooks.on("http:request", async (event) => {
    const url = event?.url || event?.href || "";
    if (!url) return;
    await enforcePolicy({ kind: "network", resource: String(url) });
  });
}

/** Descriptor + optional runtime policy hooks. */
export default function register(api) {
  registerPolicyHooks(api);
}
