(() => {
  "use strict";
  const cfg = window.NOVARANK_AUTH || {};
  const $ = id => document.getElementById(id);
  let accessToken = null;
  let tokenExpiresAt = 0;
  let authSocket = null;
  let selectedDemoAccount = null;

  function say(message) {
    const node = $("authMessage");
    if (node) node.textContent = message;
  }
  function setConnected(label) {
    const node = $("authStatus");
    if (node) {
      node.textContent = label;
      node.style.display = "inline-block";
    }
    $("connect").style.display = "none";
    $("apiConnection").style.display = "none";
    $("logout").style.display = "inline-block";
  }
  function encode64(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomString(size) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
  }
  async function startOAuth() {
    if (!cfg.clientId) { say("Add the Deriv OAuth App ID in auth-config.js first."); return; }
    if (!cfg.tokenExchangeUrl) { say("The secure exchange service must be deployed and its URL added to auth-config.js before OAuth login can start."); return; }
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
    const choices = [payload?.data?.accounts, payload?.data, payload?.accounts, payload?.items];
    return choices.find(Array.isArray) || [];
  }
  async function api(path, options = {}) {
    if (!accessToken || Date.now() >= tokenExpiresAt) throw new Error("Your Deriv session expired. Log in again.");
    const response = await fetch("https://api.derivws.com" + path, {
      ...options,
      headers: {
        Authorization: "Bearer " + accessToken,
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 ? "Deriv session expired. Log in again." : "Deriv rejected the account request (" + response.status + ").");
    return body;
  }
  async function loadDemoAccounts() {
    const payload = await api("/trading/v1/options/accounts");
    const accounts = parseAccounts(payload);
    const demos = accounts.filter(account => {
      const type = String(account.account_type || account.accountType || account.type || "").toLowerCase();
      return type === "demo" || type.includes("demo") || account.is_demo === true;
    });
    const select = $("authAccountSelect");
    select.textContent = "";
    if (!demos.length) {
      $("authAccountArea").hidden = true;
      setConnected("Deriv connected · no demo account found");
      say("Deriv authorized this app, but no demo Options account was returned. No account balance was opened.");
      $("authDialog").close();
      return;
    }
    for (const account of demos) {
      const id = account.account_id || account.id || account.loginid;
      if (!id) continue;
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = [account.account_name || account.name || "Demo account", account.currency, id].filter(Boolean).join(" · ");
      select.appendChild(option);
    }
    if (!select.options.length) throw new Error("Deriv did not return a usable demo account ID.");
    $("authAccountArea").hidden = false;
    say("Authorized. Select a demo account to read its balance. Orders remain disabled.");
    if (!$("authDialog").open) $("authDialog").showModal();
  }
  async function exchangeCode(code) {
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
    if (!response.ok || !payload.access_token) throw new Error(payload.error || "Secure token exchange failed.");
    accessToken = payload.access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 0) * 1000;
    await loadDemoAccounts();
  }
  async function connectBalance() {
    const accountId = $("authAccountSelect").value;
    if (!accountId) return;
    try {
      say("Opening a read-only demo account connection…");
      const result = await api("/trading/v1/options/accounts/" + encodeURIComponent(accountId) + "/otp", { method: "POST" });
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
          const balance = Number(message.balance.balance);
          const currency = message.balance.currency || "";
          const account = message.balance.loginid || selectedDemoAccount || accountId;
          selectedDemoAccount = account;
          setConnected("Demo · " + account + " · " + balance.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + currency);
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
    if (!cfg.clientId) { say("The Deriv App ID is missing from auth-config.js."); return; }
    accessToken = token;
    tokenExpiresAt = Date.now() + 12 * 60 * 60 * 1000;
    try {
      const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
        headers: { Authorization: "Bearer " + accessToken, "Deriv-App-ID": cfg.clientId }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 ? "Deriv rejected that token or App ID." : "Deriv rejected the account request (" + response.status + ").");
      await loadDemoAccounts();
    } catch (error) {
      accessToken = null;
      tokenExpiresAt = 0;
      say(error.message || "Could not connect with that token.");
    }
  }
  async function handleCallback() {
    const query = new URLSearchParams(location.search);
    const code = query.get("code");
    const error = query.get("error");
    if (!code && !error) return;
    const cleanUrl = location.pathname + location.hash;
    history.replaceState(null, "", cleanUrl);
    if (error) { say("Deriv sign-in was cancelled or denied. You can try again."); $("authDialog").showModal(); return; }
    try {
      say("Finishing secure Deriv sign-in…");
      await exchangeCode(code);
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
  $("logout").onclick = () => {
    accessToken = null;
    tokenExpiresAt = 0;
    selectedDemoAccount = null;
    if (authSocket) { authSocket.close(); authSocket = null; }
    $("authStatus").style.display = "none";
    $("logout").style.display = "none";
    $("connect").style.display = "";
    $("apiConnection").style.display = "";
    $("authAccountArea").hidden = true;
    $("patInput").value = "";
    say("Disconnected. Tokens are cleared from this tab's memory.");
  };
  handleCallback();
})();
