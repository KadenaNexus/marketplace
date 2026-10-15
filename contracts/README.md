# Contracts

| Path | What it is |
|---|---|
| `../p2p-escrow.pact` | Working source of the escrow module. Edit here. The app's `src/lib/kadena.ts` must match it. |
| `deployed/p2p-escrow-v10.pact` | Exact copy of what is live as `free.p2p-escrow-v10` on mainnet01, chain 1 (arbiter `k:eda1ef...98e1`, limits 1 h / 4 h / 1 h). Reference only. |
| `drafts/p2p-escrow12-DRAFT-not-deployed.pact` | Earlier draft (`p2p-escrow12`, 20-minute limits, a different arbiter key). Not used by the app. Delete when no longer needed. |

Rules
- Every deployed version gets a copy under `deployed/` plus a line here with the deploy request key and date.
- The time limits shown in the UI (`TradeWarningModal.tsx`, `src/lib/kadena.ts`) must equal the constants in the deployed file.

Deployed versions
- v10: `free.p2p-escrow-v10`, chain 1. Deploy request key: (Mustafa to add). Deployed by Mustafa Zahid, April 2026.
