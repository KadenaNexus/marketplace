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

App runs at `http://localhost:8080`. In dev, Chainweb calls go through a Vite proxy (`/chainweb-proxy` → `chainweb.chaddex.com`) to avoid CORS. Override with:

```sh
VITE_CHAINWEB_PROXY_TARGET=https://api.chainweb.com npm run dev
```

(Prod uses `https://api.chainweb.com` directly.)

## Scripts

| Script        | Description                |
|---------------|----------------------------|
| `npm run dev` | Dev server (port 8080)     |
| `npm run build` | Production build         |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint                    |

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

## Project Structure

```
src/
  lib/kadena.ts     # API host, client, tx builders, read (listEscrowIds, readEscrow), sign, submit, poll
  components/       # CreateOfferForm, EscrowActions, EscrowStatus, WalletConnect, ui
  hooks/useWallet.ts
  pages/Index.tsx
p2p-escrow.pact     # Pact module
vite.config.ts      # Proxy for /chainweb-proxy in dev
```

## License

Private / per-repo. See repository settings.
