# Deploying marketplace.kadena.ws (Hetzner)

Two processes behind nginx, both managed by PM2 (see `docs/nginx-marketplace.kadena.ws.conf`):

| PM2 name | What | Port |
|---|---|---|
| `kadena-app` | Vite frontend (`npm run build`, served from `dist/`) | 8081 |
| `kadena-server` | Profile/chat API, `server/index.js` (PostgreSQL) | 5050 |

Backend env: `PORT=5050`, `CORS_ORIGINS=https://marketplace.kadena.ws`, database settings from `.env` (never committed).

Before building the frontend, set `VITE_CHAINWEB_API` in the server `.env` to
`https://api.chainweb-community.org/chainweb/0.0/mainnet01/chain/1/pact`, or remove an old override to use the source default. Vite embeds this setting in the built assets, so changing `.env` requires a new build.

## Release steps
1. Commit the change on `main` and push it to `origin`.
2. On the server: `git pull`, `npm ci`, `npm run build`, then `pm2 restart kadena-app` (and `pm2 restart kadena-server` if `server/` changed).
3. Tag what you deployed so "what is live" is always answerable:
   `git tag deploy-marketplace-YYYY-MM-DD && git push --tags`
4. Check in light and dark mode: landing page, connect wallet, offer list, one open trade, profile, dispute page.

## Contract
The module the app talks to is set by `VITE_CONTRACT_NAMESPACE` / `VITE_CONTRACT_MODULE` in `.env` (live: `free` / `p2p-escrow-v10`).
A contract change is a new module version, deployed from `p2p-escrow.pact`; copy the deployed file to `contracts/deployed/` and record it in `contracts/README.md`.
