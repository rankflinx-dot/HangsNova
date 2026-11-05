const json = (body, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  }
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://rankflinx-dot.github.io";
    if (origin !== allowedOrigin) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin"
      }
    });
    const url = new URL(request.url);
    if (url.pathname !== "/exchange" || request.method !== "POST") return json({ error: "Not found" }, 404, allowedOrigin);
    if (!env.DERIV_CLIENT_ID || !env.DERIV_REDIRECT_URI) return json({ error: "Authentication service is not configured" }, 503, allowedOrigin);

    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid request" }, 400, allowedOrigin); }
    const code = typeof input.code === "string" ? input.code : "";
    const verifier = typeof input.code_verifier === "string" ? input.code_verifier : "";
    const redirectUri = typeof input.redirect_uri === "string" ? input.redirect_uri : "";
    if (code.length < 4 || code.length > 2048 || verifier.length < 43 || verifier.length > 128 || redirectUri !== env.DERIV_REDIRECT_URI) {
      return json({ error: "Invalid authorization response" }, 400, allowedOrigin);
    }

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.DERIV_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: env.DERIV_REDIRECT_URI
    });
    try {
      const upstream = await fetch("https://auth.deriv.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form
      });
      const payload = await upstream.json();
      if (!upstream.ok || typeof payload.access_token !== "string") {
        return json({ error: "Deriv could not complete sign-in. Check the App ID and registered redirect URL." }, 401, allowedOrigin);
      }
      return json({ access_token: payload.access_token, expires_in: payload.expires_in, token_type: payload.token_type }, 200, allowedOrigin);
    } catch {
      return json({ error: "Deriv sign-in service is temporarily unavailable." }, 502, allowedOrigin);
    }
  }
};
