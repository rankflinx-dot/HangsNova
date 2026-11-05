# NovaRank Deriv authentication deployment

The public App ID is already configured in `auth-config.js`. GitHub Pages cannot securely exchange OAuth codes or store account tokens, so NovaRank uses the Worker source in `auth-worker.js`.

## Deriv application settings

In the Deriv developer dashboard, register an OAuth 2.0 application using:

- Redirect URL: `https://rankflinx-dot.github.io/HangsNova/`
- Scope: `trade`

The `trade` permission allows trading at Deriv. NovaRank currently uses the session only to list Options accounts, connect to a demo account, and read its balance; site order execution remains disabled.

## Deploy the Worker

1. In Cloudflare, create a KV namespace for authentication sessions.
2. Create a Worker and paste in the contents of `auth-worker.js`.
3. Add the KV namespace binding named `AUTH_SESSIONS`.
4. Add these Worker environment variables:
   - `DERIV_CLIENT_ID` = `34yObA1ud7AlyT1RObT2n`
   - `DERIV_REDIRECT_URI` = `https://rankflinx-dot.github.io/HangsNova/`
5. Deploy the Worker and copy its HTTPS URL.

The Worker only accepts requests from NovaRank's GitHub Pages origin. It stores Deriv tokens in the private KV session namespace with an expiration and returns a random session handle to the browser. It does not log tokens.

## Finish site configuration

In `auth-config.js`, set `tokenExchangeUrl` to your Worker URL plus `/exchange` (example format: `https://your-worker.workers.dev/exchange`). Commit the change so GitHub Pages publishes it.

Then **Log in → Continue with Deriv** starts Authorization Code + PKCE. The callback validates state; the Worker exchanges the code and keeps the access token server-side. NovaRank lists demo accounts. Select one to request a short-lived WebSocket URL and read its balance. The session expires automatically; use **Log out** to clear it immediately.

**API connection** accepts an optional Personal Access Token and sends it over HTTPS to the same Worker. The Worker validates it with Deriv and stores it in the private session namespace for up to 12 hours. Use this only if you trust the Worker deployment. Never share tokens in chat or commit them to GitHub.

Official guides: [Deriv OAuth](https://developers.deriv.com/docs/intro/oauth/), [Authentication](https://developers.deriv.com/docs/intro/authentication/), [Options account list](https://developers.deriv.com/docs/options/get-accounts/), [authenticated WebSockets](https://developers.deriv.com/docs/options/websocket/).
