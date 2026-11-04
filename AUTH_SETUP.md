# NovaRank Deriv authentication setup

NovaRank is a public web application. Visitors must not need to register their own Deriv applications or supply an App ID.

## Shared application registration (owner setup, once)

Register one NovaRank application in the Deriv developer dashboard. Use an OAuth 2.0 application for the browser login flow and configure the exact HTTPS callback URL after the backend is deployed. The resulting client ID / App ID is application configuration, not a per-user field. Keep any client secret exclusively in the backend environment.

## User connection choices

1. **Login with Deriv (recommended for web):** Authorization Code + PKCE. Generate a fresh verifier and state per login, validate state on callback, exchange the one-time code on the server, and keep access tokens out of URLs and logs.
2. **Personal Access Token (advanced):** Deriv documents PAT apps for manual token entry and requires the registered app ID on PAT REST requests. Do not persist PATs in localStorage, sessionStorage, cookies, analytics, logs, or Git. Prefer a backend relay that handles a token only in memory for the request/session, or explicitly warn users about the risks of entering a long-lived token into a browser app. Request least-privilege scopes.

## Deployment requirement

GitHub Pages only serves static assets. It cannot run the OAuth code exchange or safely hold application secrets. Deploy the authentication API to a serverless/backend host (for example, a Vercel function) and configure HTTPS.

Required backend environment configuration:
- `DERIV_OAUTH_CLIENT_ID` — public client identifier for the NovaRank OAuth application.
- `DERIV_OAUTH_CLIENT_SECRET` — only if required by the registered Deriv app / exchange configuration; backend only.
- `DERIV_OAUTH_REDIRECT_URI` — exact HTTPS callback registered with Deriv.
- `DERIV_APP_ID` — shared app identifier where required for PAT requests.

Never put secrets in `index.html`, GitHub Pages, a public repository, or browser JavaScript.

## Current implementation status

The account-connect dialog has been added to the static UI with both requested choices. Both actions remain intentionally disabled/pending. No token is transmitted, saved, or logged, and no OAuth redirect is started yet. The backend and shared Deriv app registration must be configured before enabling either option.

Official references:
- https://developers.deriv.com/docs/intro/authentication/
- https://developers.deriv.com/docs/intro/oauth/
- https://developers.deriv.com/docs/workflows/
