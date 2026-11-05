const json = (body, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  }
});
const ALLOWED_ORIGIN = "https://rankflinx-dot.github.io";
const API = "https://api.derivws.com";

async function saveSession(env, token, seconds, isPat) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const sessionId = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  const ttl = Math.max(60, Math.min(2592000, Number(seconds) || 3600));
  await env.AUTH_SESSIONS.put("session:" + sessionId, JSON.stringify({
    token,
    isPat: Boolean(isPat),
    expiresAt: Date.now() + ttl * 1000
  }), { expirationTtl: ttl });
  return { session_id: sessionId, expires_in: ttl };
}
async function getSession(request, env) {
  const header = request.headers.get("Authorization") || "";
  const id = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const key = "session:" + id;
  const raw = await env.AUTH_SESSIONS.get(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.token || session.expiresAt <= Date.now()) {
      await env.AUTH_SESSIONS.delete(key);
      return null;
    }
    return { ...session, key };
  } catch {
    await env.AUTH_SESSIONS.delete(key);
    return null;
  }
}
async function derivFetch(path, session, env, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", "Bearer " + session.token);
  if (session.isPat) headers.set("Deriv-App-ID", env.DERIV_CLIENT_ID || "");
  return fetch(API + path, { ...init, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin"
      }
    });
    if (!env.AUTH_SESSIONS || !env.DERIV_CLIENT_ID || !env.DERIV_REDIRECT_URI) return json({ error: "Private session storage or Deriv app settings are not configured." }, 503, ALLOWED_ORIGIN);
    const url = new URL(request.url);
    try {
      if (url.pathname === "/exchange" && request.method === "POST") {
        const input = await request.json();
        const code = typeof input.code === "string" ? input.code : "";
        const verifier = typeof input.code_verifier === "string" ? input.code_verifier : "";
        const redirectUri = typeof input.redirect_uri === "string" ? input.redirect_uri : "";
        if (code.length < 4 || code.length > 2048 || verifier.length < 43 || verifier.length > 128 || redirectUri !== env.DERIV_REDIRECT_URI) {
          return json({ error: "Invalid authorization response." }, 400, ALLOWED_ORIGIN);
        }
        const form = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: env.DERIV_CLIENT_ID || "",
          code,
          code_verifier: verifier,
          redirect_uri: env.DERIV_REDIRECT_URI
        });
        const upstream = await fetch("https://auth.deriv.com/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form
        });
        const payload = await upstream.json();
        if (!upstream.ok || typeof payload.access_token !== "string") return json({ error: "Deriv could not complete sign-in. Check the App ID and registered redirect URL." }, 401, ALLOWED_ORIGIN);
        return json(await saveSession(env, payload.access_token, payload.expires_in, false), 200, ALLOWED_ORIGIN);
      }

      if (url.pathname === "/pat" && request.method === "POST") {
        const input = await request.json();
        const token = typeof input.token === "string" ? input.token.trim() : "";
        if (token.length < 8 || token.length > 4096) return json({ error: "Invalid API token." }, 400, ALLOWED_ORIGIN);
        const response = await fetch(API + "/trading/v1/options/accounts", {
          headers: { Authorization: "Bearer " + token, "Deriv-App-ID": env.DERIV_CLIENT_ID || "" }
        });
        if (!response.ok) return json({ error: response.status === 401 ? "Deriv rejected that token or App ID." : "Deriv could not verify the account token." }, response.status, ALLOWED_ORIGIN);
        const accountData = await response.json();
        const session = await saveSession(env, token, 43200, true);
        return json({ ...session, accounts: accountData }, 200, ALLOWED_ORIGIN);
      }

      if (url.pathname === "/accounts" && request.method === "GET") {
        const session = await getSession(request, env);
        if (!session) return json({ error: "Session expired. Log in again." }, 401, ALLOWED_ORIGIN);
        const response = await derivFetch("/trading/v1/options/accounts", session, env);
        return new Response(await response.text(), { status: response.status, headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Vary": "Origin"
        } });
      }

      if (url.pathname === "/otp" && request.method === "POST") {
        const session = await getSession(request, env);
        if (!session) return json({ error: "Session expired. Log in again." }, 401, ALLOWED_ORIGIN);
        const input = await request.json();
        const accountId = typeof input.account_id === "string" ? input.account_id : "";
        if (!/^[A-Za-z0-9_-]{4,40}$/.test(accountId)) return json({ error: "Invalid account ID." }, 400, ALLOWED_ORIGIN);
        const response = await derivFetch("/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp", session, env, { method: "POST" });
        return new Response(await response.text(), { status: response.status, headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Vary": "Origin"
        } });
      }

      if (url.pathname === "/logout" && request.method === "POST") {
        const session = await getSession(request, env);
        if (session) await env.AUTH_SESSIONS.delete(session.key);
        return json({ ok: true }, 200, ALLOWED_ORIGIN);
      }
      return json({ error: "Not found." }, 404, ALLOWED_ORIGIN);
    } catch {
      return json({ error: "Authentication service request failed." }, 502, ALLOWED_ORIGIN);
    }
  }
};
