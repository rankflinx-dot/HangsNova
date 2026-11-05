# NovaRank Deriv authentication deployment

The public Deriv App ID and callback are configured in `auth-config.js`. The site is already set to call the Worker endpoint:
`https://novarank-auth-api.rankflinx.workers.dev/exchange`.

GitHub Pages is static, so the Cloudflare Worker performs the OAuth code exchange and stores tokens in a private KV namespace.

## Deriv application settings

Register this exact redirect URL for the Deriv OAuth application:

- `https://rankflinx-dot.github.io/HangsNova/`
- Scope: `trade`

The site currently uses authentication only to list Options accounts, connect to a demo account, and read its balance. Order execution is disabled.

## Finish Cloudflare setup

Open the existing `novarank-auth-api` Worker in Cloudflare:

1. Choose **Edit code** / **Quick edit**.
2. Replace all starter code with the full contents of [`auth-worker.js`](https://github.com/rankflinx-dot/HangsNova/blob/main/auth-worker.js).
3. Save and deploy.
4. Open **Settings → Bindings** and add a KV namespace binding:
   - Variable name: `AUTH_SESSIONS`
   - Namespace: `novarank-auth-sessions`
5. Open **Settings → Variables and Secrets** and add these text variables:
   - `DERIV_CLIENT_ID` = `34yObA1ud7AlyT1RObT2n`
   - `DERIV_REDIRECT_URI` = `https://rankflinx-dot.github.io/HangsNova/`
6. Save changes and deploy again if prompted.

The Worker should be available at `https://novarank-auth-api.rankflinx.workers.dev`. The site configuration already includes the `/exchange` path. After deployment, report the status shown in Cloudflare; do not send any API tokens or OAuth codes.

The Worker only accepts requests from NovaRank's GitHub Pages origin. It stores Deriv tokens in the private KV session namespace with an expiration and returns a random session handle to the browser. It does not log tokens.

## How sign-in works

**Log in → Continue with Deriv** starts Authorization Code + PKCE. The callback validates state; the Worker exchanges the code and keeps the access token server-side. NovaRank lists demo accounts. Select one to request a short-lived WebSocket URL and read its balance. The session expires automatically; use **Log out** to clear it immediately.

**API connection** accepts an optional Personal Access Token and sends it over HTTPS to the Worker for validation. The Worker stores it in the private namespace for up to 12 hours. Never share tokens in chat or commit them to GitHub. Only use this route if you trust the Worker deployment.

Official guides: [Deriv OAuth](https://developers.deriv.com/docs/intro/oauth/), [Authentication](https://developers.deriv.com/docs/intro/authentication/), [Options account list](https://developers.deriv.com/docs/options/get-accounts/), [authenticated WebSockets](https://developers.deriv.com/docs/options/websocket/).
