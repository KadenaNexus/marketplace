# Kadena P2P Escrow

Non-custodial peer-to-peer escrow dApp on **Kadena** (mainnet01, chain 1). Trades are secured by the `free.p2p-escrow` Pact module; funds are held in the contract until release or refund.

## Features

- **Create Offer** — Seller creates an offer (ID, amount in KDA). Platform arbiter is set in the contract.
- **Accept Offer** — Buyer accepts a CREATED offer.
- **Deposit** — Seller sends KDA to the escrow vault (ACCEPTED → FUNDED).
- **Mark Paid** — Buyer confirms off-chain payment (FUNDED → PAID).
- **Release** — Seller or arbiter releases funds to the buyer (PAID → COMPLETED).
- **Refund** — Arbiter refunds to the seller from FUNDED or PAID.
- **Close Offer** — Seller closes an offer in CREATED state.
- **Wallet-linked profiles** — Username, avatar, bio. Create/edit requires proving wallet ownership via a signed message (no editing by entering an address). Public profile at `/u/<wallet>`. Profile summaries in the offer list and trade screens.

## Tech Stack

- **Frontend:** React, TypeScript, Vite
- **UI:** Tailwind CSS, shadcn/ui, Lucide, Sonner (toast)
- **Chain:** `@kadena/client` (Pact, send, local, poll)
- **Wallet:** Ecko Wallet (`kda_connect`, `createSignWithEckoWallet`)

## Prerequisites

- **Node.js** 18+ and npm (or yarn/bun)
- **Ecko Wallet** (browser) on Kadena mainnet01, chain 1, with KDA for gas

## Run Locally

```sh
git clone <YOUR_REPO_URL>
cd Kadena-NEXUS

npm install
npm run dev
```

For **profile** features (create/edit, summaries), also run the profile API in another terminal. Profiles are stored in **MongoDB** (off-chain); offers/escrows stay on-chain only.

```sh
# Ensure MongoDB is running (e.g. local or Atlas). Then:
MONGODB_URI=mongodb://localhost:27017 npm run dev:server
```

- `MONGODB_URI` — default `mongodb://localhost:27017`
- `MONGODB_DB` — default `kadena_nexus` (database name)

This starts the profile API on port 3001. The Vite dev server proxies `/api` to it.

App runs at `http://localhost:8080`. In dev, Chainweb calls go through a Vite proxy (`/chainweb-proxy` → `chainweb.chaddex.com`) to avoid CORS. Override with:

```sh
VITE_CHAINWEB_PROXY_TARGET=https://chainweb.chaddex.com npm run dev
```

(Prod uses `https://chainweb.chaddex.com` directly.)

## Scripts

| Script           | Description                       |
|------------------|-----------------------------------|
| `npm run dev`    | Dev server (port 8080)            |
| `npm run dev:server` | Profile API (port 3001)       |
| `npm run build`  | Production build                  |
| `npm run preview`| Preview production build          |
| `npm run lint`   | ESLint                            |

## Contract Deployment

The Pact module `free.p2p-escrow` requires the `escrows` table to exist. Run **in the same deployment transaction** as the module (signed by the deployer):

```pact
(create-table free.p2p-escrow.escrows)
```

The dApp **Initialize** action will fail with “Module admin is necessary” because only the deployer can create the table. See **DEPLOY.md** (if present) or your deployment tooling for full steps.

## Configuration

- **Network:** `mainnet01`, **Chain:** `1`
- **Contract:** `free.p2p-escrow` (`CONTRACT_NAMESPACE`, `CONTRACT_MODULE` in `src/lib/kadena.ts`)
- **Arbiter:** Set in the Pact constant `PLATFORM_ARBITER` before deployment
- **MongoDB (profiles only):** `MONGODB_URI`, `MONGODB_DB` — offers/escrows are **not** in MongoDB; they stay on-chain (Pact)

## Project Structure

```
src/
  lib/kadena.ts       # API host, client, tx builders, read, sign, submit, poll, buildProfileAuthTx
  lib/profileApi.ts   # fetchProfile, putProfile, fetchProfilesBulk
  components/         # CreateOfferForm, EscrowActions, EscrowStatus, WalletConnect, ProfileEdit, ProfileSummary, ui
  hooks/useWallet.ts
  pages/Index.tsx, Profile.tsx
server/
  index.js            # Profile API: GET/PUT /api/profiles, POST /api/profiles/bulk; MongoDB (profiles only); verifies signed proof
p2p-escrow.pact       # Pact module
vite.config.ts        # Proxy for /chainweb-proxy and /api in dev
```

## License

Private / per-repo. See repository settings.
