# Kadena P2P Marketplace

Part of [Kadena Nexus](https://kadena.ws). Live at https://marketplace.kadena.ws. Peer-to-peer KDA trading with the seller's coins held by the `free.p2p-escrow-v10` Pact module on chain 1 until the buyer's payment is confirmed; a platform arbiter settles disputes and timeouts.

Built by Mica Dimic (winner of the Kadena Devs escrow challenge, January to April 2026), with contributions from Mirza Muhammad Baig (April 2026) and Mustafa Zahid (contract v6 to v10 fixes, timers, trade warning pop-up; maintainer since April 2026).

- Deploying: see `DEPLOY.md`. Contract versions: see `contracts/README.md`.
- This branch (`marketplace`) is the home of the marketplace code. It continues the old `Cool-Dev` branch (commit 11a381b), which was overwritten by a force-push on 12 Aug 2026 and restored as `recovered/Cool-Dev-marketplace`.

---

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

This starts the profile API on port 3001. The Vite dev server proxies `/api` and `/socket.io` (WebSocket) to it. If you see **ws proxy error: ECONNRESET** in the Vite terminal, run `npm run dev:server` in another terminal so the profile API is up.

App runs at `http://localhost:8080`. Chainweb is called **directly** (no proxy): the app uses `VITE_CHAINWEB_API` or the default API base (e.g. `https://chainweb.chaddex.com`). Override with:

```sh
VITE_CHAINWEB_API=https://api.chainweb.com/chainweb/0.0/mainnet01/chain/1/pact npm run dev
```

If you see CORS errors in the browser, the API may not allow requests from your origin; you can try another API or run a small proxy yourself.

## Scripts

| Script           | Description                       |
|------------------|-----------------------------------|
| `npm run dev`    | Dev server (port 8080)            |
| `npm run dev:server` | Profile API (port 3001)       |
| `npm run build`  | Production build                  |
| `npm run preview`| Preview production build          |
| `npm run lint`   | ESLint                            |

## Contract Deployment

The Pact module is `free.p2p-escrow5` (see `CONTRACT_MODULE` in `src/lib/kadena.ts`; must match `(module ...)` in `p2p-escrow.pact`). It provides:

- **Strict state machine** — CREATED → ACCEPTED → FUNDED → PAID → COMPLETED (or REFUNDED/CLOSED/DISPUTED via timeouts or arbiter).
- **Timed transitions (only after funded)** — T2 (mark paid) and T3 (release / dispute) start once KDA is in escrow. Before funding, creator can close the offer (CREATED or ACCEPTED); no contract time limits pre-fund. Config still stores `t1` for compatibility; it is unused for logic.
- **Admin** — `init-config` and `set-config(arbiter, t1, t2, t3)` (GOVERNANCE). GOVERNANCE is restricted: only a signer that satisfies the keyset `admin-keyset` (provided in tx data) can grant it — so only the admin can upgrade the module or run init/set-config.
- **Vault** — Per-offer accounts use a **capability user guard** (not a keyset). Only the module can transfer from vaults (release/refund); see [Kadena deprecation notice for module guards](https://medium.com/kadena-io/deprecation-notice-for-module-guards-and-pact-guards-2efbf64f488f).

### One-transaction deploy (recommended)

`p2p-escrow.pact` ends with an **init block** that runs in the **same transaction** as the module load. One deploy = module + create tables + init config.

1. Deploy the **entire** `p2p-escrow.pact` file (module + the block at the end) in one transaction.
2. The deploy tx **must include** in its data the keyset `admin-keyset` (e.g. `{ "keys": ["<your-admin-pubkey>"], "pred": "keys-all" }`). Only a signer that satisfies this keyset can grant GOVERNANCE.
3. When signing the deploy tx you **must grant** the capability `free.p2p-escrow5.GOVERNANCE` (or `{namespace}.{module}.GOVERNANCE` if you changed the module name):
   - **Chainweaver:** Add the capability `free.p2p-escrow5.GOVERNANCE` to the signer and include `admin-keyset` in the transaction data with your admin public key. If you don't add it, you get "Module admin is necessary but has not been acquired."
4. For **upgrades** (tables already exist), remove or comment out the block at the end of the file to avoid "table already exists."

### Tables and init in same tx

The init block at the end of `p2p-escrow.pact` uses top-level `create-table` (allowed only at tx top level) and then `init-config`. It runs in the same transaction as the module load, so you don't need a separate init step — as long as you grant GOVERNANCE when signing the deploy tx.

After deploying the module (with the init block), you do **not** need a separate init. If you used a two-step deploy (no init block), run **one** init (see **One function in Chainweaver after deploy** below).

The dApp **Initialize** action may fail with “Module admin is necessary” if you never ran init (or didn't grant GOVERNANCE when deploying). If you see "Operation is not allowed in read-only or system-only mode" when creating an offer, the contract tables were likely never created—run init once (Chainweaver or `buildInitAllTx`) with the GOVERNANCE key, or redeploy with GOVERNANCE granted.

### Two-step deploy (optional)

If you deploy **without** the init block at the end of `p2p-escrow.pact`, deploying only loads the code. You must create tables by calling `create-table` (via the init block or `p2p-escrow-deploy-init.pact`) in a **separate** transaction. You cannot create tables by “just” deploying.

### One function in Chainweaver after deploy

After you deploy `p2p-escrow.pact`, run **one** transaction to create tables and set config:

1. Open **Chainweaver** and connect to the same network/chain you deployed to (e.g. mainnet01, chain 1).
2. Go to **Interact** (or the Pact REPL / “Run” screen).
3. In the **Pact code** field, paste the full block from `p2p-escrow-deploy-init.pact` (with-capability + create-table x3 + init-config). Do not use init-all alone — tables must be created at tx top level.
4. Set **Sender** to the account that deployed the module (the one that has GOVERNANCE).
5. Add the **GOVERNANCE** capability when signing (sign with the deployer key so `free.p2p-escrow5.GOVERNANCE` is granted).
6. Send the transaction.

Run init in a **separate** transaction after deploy (two-step deploy). Use the block from `p2p-escrow-deploy-init.pact` or `buildInitAllTx` — this creates tables and sets config. After it succeeds, `create-offer` will work (if the node allows writes).

### Init from the dApp

Call `buildInitAllTx(governanceAccount, governancePubKey)` (in `src/lib/kadena.ts`), sign with the GOVERNANCE key, and submit. Same effect as running the block from `p2p-escrow-deploy-init.pact` in Chainweaver.

### "Module admin is necessary but has not been acquired"

This happens when you run the init transaction (p2p-escrow-deploy-init.pact) but the **GOVERNANCE** capability was not granted. Fix:

1. **Sign with the same key that deployed the module** — The account/key that deployed `p2p-escrow.pact` is the "module admin" and the only one who can grant GOVERNANCE.
2. **Grant the capability when signing** — In Chainweaver, when you sign the init tx, you must **add** the capability `free.p2p-escrow5.GOVERNANCE` (or your module name) to the signer so you are granting it. If you don't add it, the capability is not acquired and you get this error.

So: **Sender** = deployer account, **Signer** = deployer key, **Data** = include `admin-keyset` with `{ "keys": ["<deployer-pubkey>"], "pred": "keys-all" }`, and when signing add the capability **free.p2p-escrow5.GOVERNANCE**.

### "Operation is not allowed in read-only or system-only mode" (mainnet chain 1)

Your console shows: tx **mined** (blockHeight, events), but **result.status: "failure"** at the `insert escrows` step. The **node** that executed the tx (e.g. chainweb.chaddex.com on mainnet) is **read-only for user table writes** — the contract and frontend are correct.

**For mainnet chain 1 only:** You need a **write-capable** node. The public community API may be read-only for user tables. Options:

1. **Run your own Chainweb node** on mainnet (chain 1), then in `.env` set `VITE_CHAINWEB_API` to the full Pact URL (e.g. `https://YOUR_NODE_HOST/chainweb/0.0/mainnet01/chain/1/pact`). Your node will have write capability.
2. Use another mainnet API that supports writes, if available, and point the app to it the same way.

**Debug:** Browser console shows `[CreateOffer] Chain API used:` and the full poll result. Dev UI shows **Chain API:** at the bottom of the Create Offer form. If tables were never initialized, run init once with GOVERNANCE.

**Best practice:** Run your own write-capable Chainweb node, or use a provider that supports writes. Keep `VITE_CHAINWEB_API` configurable (already supported via `.env`) so you can point the app at your node or a write-capable API without code changes.

### "Insert failed because of a schema mismatch with free.p2p-escrow4.escrow"

The on-chain table for that module was created with an **older schema** (e.g. different field types). Pact tables keep their schema forever; upgrading the module code does not change the existing table.

**Fix:** This repo now uses module **p2p-escrow5** so a **new** table is created with the current schema. Redeploy the **entire** `p2p-escrow.pact` file (module + init block at the end) as one transaction, and when signing **grant** `free.p2p-escrow5.GOVERNANCE`. The app defaults to `p2p-escrow5`; no `.env` change needed. Create new offers after that; accept/deposit/release will work. Old offers in p2p-escrow4 remain on-chain but the app will only list and use offers in p2p-escrow5.

## Configuration

- **Network:** `mainnet01`, **Chain:** `1`
- **Chainweb API:** `VITE_CHAINWEB_API` — configurable (e.g. in `.env`). Use a write-capable node or provider for mainnet; some public endpoints are read-only for user table writes. Default may be a community API; override to point at your node or a write-capable provider.
- **Contract:** `free.p2p-escrow5` by default (`CONTRACT_NAMESPACE`, `CONTRACT_MODULE` in `src/lib/kadena.ts`; overridable via `VITE_CONTRACT_NAMESPACE`, `VITE_CONTRACT_MODULE`. Must match the module name in `p2p-escrow.pact`.)
- **Arbiter:** Set in the Pact constant `PLATFORM_ARBITER` before deployment
- **PostgreSQL (profiles only):** `DATABASE_URL` — offers/escrows are **not** in PostgreSQL; they stay on-chain (Pact)

### Custom namespace and "Namespace not found"

If you see **"Namespace not found: saudi"** (or any name), that namespace does **not** exist on the chain. Kadena does not create namespaces automatically.

- **Use `free` (recommended):** The namespace `free` exists on mainnet. Keep `(namespace "free")` in `p2p-escrow.pact` and set `VITE_CONTRACT_NAMESPACE=free` (or leave unset). No extra steps.
- **Vanity names (e.g. `saudi`, `mycompany`):** These only work if they were already registered on the chain (historically via Kadena). You cannot invent a new vanity name without it existing first.
- **Principal namespace:** You can create a namespace derived from your keyset: call `ns.create-principal-namespace (read-keyset "admin-keyset")` in a tx; it returns an opaque name like `n_c1a583206e24450af26de41110042b019695db8c`. Then use that string in `(namespace "n_...")` and in the init block. See [Kadena’s namespace guide](https://www.kadena.io/perspectives/an-introductory-guide-to-kadena-namespaces).

If you change namespace or module name in the Pact file, update the **init block at the end** of `p2p-escrow.pact` to use the same `{namespace}.{module}.GOVERNANCE` (and table names), and set `VITE_CONTRACT_NAMESPACE` and `VITE_CONTRACT_MODULE` in `.env` to match.

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
p2p-escrow.pact       # Full Pact module (business logic)
p2p-escrow-init.pact  # Minimal module (tables + init only; deploy first to init empty)
vite.config.ts        # Proxy for /api and /socket.io (profile server) in dev
```

## License

Private / per-repo. See repository settings.
