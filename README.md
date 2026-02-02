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

For **profile** features (create/edit, summaries), also run the profile API in another terminal. Profiles are stored in **PostgreSQL** (off-chain); offers/escrows stay on-chain only.

### PostgreSQL Setup

**Option 1: Local PostgreSQL Installation**
1. Install PostgreSQL from https://www.postgresql.org/download/
2. Create database and run schema:
   ```sh
   psql -U postgres -c "CREATE DATABASE kadena_nexus;"
   psql -U postgres -d kadena_nexus -f server/schema.sql
   ```

**Option 2: Docker (Recommended for Development)**
```sh
# Start PostgreSQL in Docker
docker run --name kadena-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kadena_nexus -p 5432:5432 -d postgres

# Run schema
docker exec -i kadena-postgres psql -U postgres -d kadena_nexus < server/schema.sql
```

**Option 3: Cloud PostgreSQL (Production)**
Use services like:
- Supabase (free tier available)
- AWS RDS
- Google Cloud SQL
- Azure Database for PostgreSQL

### Start the Server

```sh
# With default connection (localhost)
npm run dev:server

# Or with custom connection string
DATABASE_URL=postgresql://user:password@host:port/kadena_nexus npm run dev:server
```

- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql://localhost:5432/kadena_nexus`)
  - Format: `postgresql://[user[:password]@][host][:port][/database]`
  - Example: `postgresql://postgres:postgres@localhost:5432/kadena_nexus`

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

The Pact module `free.p2p-escrow` is production-ready with:

- **Strict state machine** — CREATED → ACCEPTED → FUNDED → PAID → COMPLETED (or REFUNDED/CLOSED/DISPUTED via timeouts or arbiter).
- **Timed transitions** — T1/T2/T3 (default 10 min each); timeouts auto-close, refund, or escalate to DISPUTED.
- **Events** — Every state change is logged (offerId, eventType, fromState, toState, actor, blockTime) for UI activity and audit.
- **Completed trades** — On release, the contract writes to `completed-trades`; rating enforcement can use `get-completed-trade` / `list-completed-offer-ids`.
- **Admin** — `init-config` and `set-config(arbiter, t1, t2, t3)` (GOVERNANCE) to set arbiter and timeout seconds.

After deploying the module, run **one** init transaction (signed by the deployer with GOVERNANCE):

- **Minimal:** `buildInitTx` — creates only `escrows`.
- **Full (recommended):** `buildInitAllTx` — creates `escrows`, `events`, `completed-trades`, `config`, `offer-event-ids` and runs `init-config`.

The dApp **Initialize** action may fail with “Module admin is necessary” because only the deployer can create tables. Use your deployment tooling or sign `buildInitAllTx` with the deployer key.

## Configuration

- **Network:** `mainnet01`, **Chain:** `1`
- **Contract:** `free.p2p-escrow` (`CONTRACT_NAMESPACE`, `CONTRACT_MODULE` in `src/lib/kadena.ts`)
- **Arbiter:** Set in the Pact constant `PLATFORM_ARBITER` before deployment
- **PostgreSQL (profiles only):** `DATABASE_URL` — offers/escrows are **not** in PostgreSQL; they stay on-chain (Pact)

## Project Structure

```
src/
  lib/kadena.ts       # API host, client, tx builders, read, sign, submit, poll, buildProfileAuthTx
  lib/profileApi.ts   # fetchProfile, putProfile, fetchProfilesBulk
  components/         # CreateOfferForm, EscrowActions, EscrowStatus, WalletConnect, ProfileEdit, ProfileSummary, ui
  hooks/useWallet.ts
  pages/Index.tsx, Profile.tsx
server/
  index.js            # Profile API: GET/PUT /api/profiles, POST /api/profiles/bulk; PostgreSQL (profiles only); verifies signed proof
  schema.sql          # PostgreSQL database schema initialization
p2p-escrow.pact       # Pact module
vite.config.ts        # Proxy for /chainweb-proxy and /api in dev
```

## License

Private / per-repo. See repository settings.
