# DerivNova

An independent third-party Deriv market dashboard. This project is not affiliated with Deriv.

## Current preview

Open [derivnova.html](./derivnova.html) on GitHub Pages or serve the repository as a static site. The preview connects to Deriv's public WebSocket endpoint for live market ticks only.

- Displays four synthetic market tick streams.
- Shows the requested manual contract categories and types as a UI preview.
- Does not authenticate, request account balance, request a contract proposal, or place trades.
- Does not ask for or store API tokens.

## Next development steps

1. Secure demo-account authorization, without exposing credentials in public source.
2. Account balance only after explicit, secure authorization.
3. Fetch market-specific available contracts and implement manual demo trading with confirmation and risk controls.
4. Add automated trading, hedge trading, analysis, and history in later stages.

## Local preview

Open `derivnova.html` in a modern browser. A network connection is required for live ticks; the static interface remains viewable without one.
