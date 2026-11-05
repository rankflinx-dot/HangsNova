(() => {
  "use strict";
  const cfg = window.NOVARANK_AUTH || {};
  const $ = id => document.getElementById(id);
  let sessionId = null;
  let sessionExpiresAt = 0;
  let authSocket = null;

  function say(message) {
    const node = $("authMessage");
    if (node) node.textContent = message;
  }
  function setConnected(label) {
    const node = $("authStatus");
    if (node) { node.textContent = label; node.style.display = "inline-block"; }
    $("connect").style.display = "none";
    $("apiConnection").style.display = "none";
    $("logout").style.display = "inline-block";
  }
  function workerUrl(path) {
    if (!cfg.tokenExchangeUrl) throw new Error("The secure Deriv connection service is not deployed yet.");
    const base = cfg.tokenExchangeUrl.replace(/\/(exchange|accounts|otp|pat|logout)\/?$/, "").replace(/\/$/, "");
    return base + path;
  }
  function sessionHeaders() {
    if (!sessionId || Date.now() >= sessionExpiresAt) throw new Error("Your Deriv session expired. Log in again.");
    return { Authorization: "Bearer " + sessionId };
  }
  async function workerRequest(path, method = "GET", body) {
    const headers = { ...sessionHeaders() };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(workerUrl(path), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Deriv connection failed (" + response.status + ").");
    return payload;
  }
  function randomString(size) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
  }
  function encode64(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function startOAuth() {
    if (!cfg.clientId) { say("Deriv OAuth App ID is missing."); return; }
    if (!cfg.tokenExchangeUrl) { say("The secure connection service is being prepared. Set its URL in auth-config.js after deployment."); return; }
    const verifier = randomString(64);
    const challenge = encode64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = randomString(32);
    sessionStorage.setItem("novarank_oauth_verifier", verifier);
    sessionStorage.setItem("novarank_oauth_state", state);
    const target = new URL("https://auth.deriv.com/oauth2/auth");
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: "trade",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    }).toString();
    location.assign(target.href);
  }
  function parseAccounts(payload) {
    const candidates = [payload?.data?.accounts, payload?.data, payload?.accounts, payload?.items];
    return candidates.find(Array.isArray) || [];
  }
  async function loadDemoAccounts(accountPayload) {
    const payload = accountPayload || await workerRequest("/accounts");
    const accounts = parseAccounts(payload);
    const demos = accounts.filter(account => {
      const type = String(account.account_type || account.accountType || account.type || "").toLowerCase();
      return type === "demo" || type.includes("demo") || account.is_demo === true;
    });
    const select = $("authAccountSelect");
    select.textContent = "";
    if (!demos.length) {
      $("authAccountArea").hidden = true;
      setConnected("Deriv connected · no demo account");
      say("Deriv authorized this app, but no demo Options account was returned. No account was opened.");
      $("authDialog").close();
      return;
    }
    for (const account of demos) {
      const id = account.account_id || account.accountId || account.id || account.loginid;
      if (!id) continue;
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = [account.account_name || account.name || "Demo account", account.currency, id].filter(Boolean).join(" · ");
      select.appendChild(option);
    }
    if (!select.options.length) throw new Error("Deriv did not return a usable demo account ID.");
    $("authAccountArea").hidden = false;
    say("Authorized. Select a demo account to read its balance. NovaRank does not place orders.");
    if (!$("authDialog").open) $("authDialog").showModal();
  }
  async function finishOAuth(code) {
    const expectedState = sessionStorage.getItem("novarank_oauth_state");
    const verifier = sessionStorage.getItem("novarank_oauth_verifier");
    const returnedState = new URLSearchParams(location.search).get("state");
    sessionStorage.removeItem("novarank_oauth_state");
    sessionStorage.removeItem("novarank_oauth_verifier");
    if (!expectedState || !verifier || returnedState !== expectedState) throw new Error("Deriv sign-in could not be verified. Please start again.");
    const response = await fetch(cfg.tokenExchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: cfg.redirectUri })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.session_id) throw new Error(payload.error || "Secure token exchange failed.");
    sessionId = payload.session_id;
    sessionExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    await loadDemoAccounts();
  }
  async function connectBalance() {
    try {
      say("Opening a read-only demo account connection…");
      const accountId = $("authAccountSelect").value;
      const result = await workerRequest("/otp", "POST", { account_id: accountId });
      const wsUrl = result?.data?.url || result?.url;
      if (!wsUrl || !wsUrl.startsWith("wss://api.derivws.com/")) throw new Error("Deriv did not return a valid account connection URL.");
      if (authSocket) authSocket.close();
      authSocket = new WebSocket(wsUrl);
      authSocket.onopen = () => authSocket.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: 5101 }));
      authSocket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.error) { say("Account balance could not be read. Please log in again."); return; }
        if (message.msg_type === "balance" && message.balance) {
          const amount = Number(message.balance.balance);
          const currency = message.balance.currency || "";
          const login = message.balance.loginid || $("authAccountSelect").value;
          setConnected("Demo · " + login + " · " + amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + currency);
          say("Read-only demo account connected. NovaRank has not placed any orders.");
          if ($("authDialog").open) $("authDialog").close();
        }
      };
      authSocket.onerror = () => say("Could not open the secure demo connection. Try again.");
    } catch (error) { say(error.message || "Could not connect to the demo account."); }
  }
  async function connectPat() {
    const field = $("patInput");
    const token = field.value.trim();
    field.value = "";
    if (!token) { say("Paste a Deriv Personal Access Token to connect."); return; }
    if (!cfg.clientId) { say("The Deriv App ID is missing."); return; }
    try {
      say("Sending token securely to NovaRank's authentication service for validation…");
      const response = await fetch(workerUrl("/pat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.session_id) throw new Error(payload.error || "Deriv rejected that token.");
      sessionId = payload.session_id;
      sessionExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 43200) * 1000;
      await loadDemoAccounts(payload.accounts);
    } catch (error) {
      sessionId = null;
      say(error.message || "Could not connect with that token.");
    }
  }
  async function handleCallback() {
    const query = new URLSearchParams(location.search);
    const code = query.get("code");
    const error = query.get("error");
    if (!code && !error) return;
    history.replaceState(null, "", location.pathname + location.hash);
    if (error) { say("Deriv sign-in was cancelled or denied. You can try again."); $("authDialog").showModal(); return; }
    try {
      say("Finishing secure Deriv sign-in…");
      await finishOAuth(code);
    } catch (issue) {
      say(issue.message || "Could not finish Deriv sign-in.");
      $("authDialog").showModal();
    }
  }
  $("oauthConnect").disabled = false;
  $("oauthConnect").textContent = "Continue with Deriv";
  $("oauthConnect").onclick = () => startOAuth().catch(error => say(error.message || "Could not start Deriv sign-in."));
  $("patConnect").onclick = connectPat;
  $("connectDemoAccount").onclick = connectBalance;
  $("apiConnection").onclick = () => { $("authDialog").showModal(); setTimeout(() => $("patInput").focus(), 0); };
  $("logout").onclick = async () => {
    if (authSocket) { authSocket.close(); authSocket = null; }
    try { if (sessionId) await workerRequest("/logout", "POST", {}); } catch {}
    sessionId = null;
    sessionExpiresAt = 0;
    $("authStatus").style.display = "none";
    $("logout").style.display = "none";
    $("connect").style.display = "";
    $("apiConnection").style.display = "";
    $("authAccountArea").hidden = true;
    $("patInput").value = "";
    say("Disconnected. This tab's session has been cleared.");
  };
  handleCallback();
})();
