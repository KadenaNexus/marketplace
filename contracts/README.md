# Contracts

| Path | What it is |
|---|---|
| `p2p-escrow-v11.pact` | **The advanced Marketplace escrow (v11).** Pool offers with a min/max per trade, trades start funded, instant Kadena-token settlement, USDT/USDC flows with agent release, fee, pause, events. Not deployed yet. |
| `test/p2p-escrow-v11.repl` | Tests for v11 (Pact 5.4). Run `contracts/test/run.sh`. |
| `test/vendor/` | `coin`, `fungible-v2`, `fungible-xchain-v1` as on mainnet, for the tests only. |
| `deployed/p2p-escrow-v10.pact` | Copy of what is live as `free.p2p-escrow-v10` on mainnet01, chain 1. Verified identical to the on-chain module on 2026-10-15 (module explorer vs this file). Reference only; v10 keeps running for its open trades and history. |
| `../p2p-escrow.pact` | The v10 working copy inherited from the public marketplace repo. Kept until the site is fully on v11. |
| `drafts/` | Old drafts. Not used. |

## v11 at a glance

| | v10 (live) | v11 |
|---|---|---|
| Offer | one fixed amount, one buyer | a pool with min/max per trade, many buyers at once |
| Steps for a sell offer | accept → deposit (1 h) → pay → mark paid → release | take (already funded) → pay → release (agent or seller) |
| Instant settlement | no | yes, any Kadena token (kb-USDC, kb-ETH, FLUX, BRO…) via `take-and-settle` |
| Payment window | fixed 4 h | per offer, 15 min to 24 h |
| Who can release | seller, arbiter | seller, the offer's agent; arbiter only in a dispute (with a split) |
| Buyer cancel | no | yes, before paying |
| Fee | none | basis points, hard cap 1%, **0 at launch**; per-trade snapshot |
| Pause | no | yes; never blocks releases, refunds or withdrawals |
| Events | no | every offer and trade step |
| Reputation | on chain | on chain (trades, successes, disputes, cancels, volume); the site adds v10 history |
| Chain | 1 | any; launch on chain 1 |

## Deployment (not done yet)

1. Governance keyset `free.p2p-escrow-v11-gov`: the same two Chainweaver wallets that deployed v10, `keys-all`.
2. Deploy `p2p-escrow-v11.pact` on mainnet01 chain 1 with `gov-keyset` in the transaction data, then run once:
   `(create-table free.p2p-escrow-v11.config)` `(… offers)` `(… trades)` `(… reputation)`
   `(free.p2p-escrow-v11.init-config "<arbiter k: account>" "<fee k: account>")`
3. Copy the deployed file to `deployed/p2p-escrow-v11.pact` and add the request key and date here.
4. Point the site at v11 (`VITE_CONTRACT_MODULE=p2p-escrow-v11`); v10 stays readable for history.

Deployed versions
- v10: `free.p2p-escrow-v10`, chain 1. Deployed by Naif (two Chainweaver wallets as governance), April 2026.
- v11: not yet.

## Notes for review

- Every KDA movement is listed at the top of `p2p-escrow-v11.pact`. Vaults are principal accounts guarded by `OFFER_VAULT` / `TRADE_VAULT`, which only this module can acquire (`contracts/test` checks that).
- `take-and-settle` verifies the token module by name (`(format "{}" [token])` against the offer's stored module name); the buyer signs the token's own `TRANSFER` capability.
- An offer with `available` 0 stays `OPEN` so its creator can top it up; the site hides offers with less than their minimum left.
- A buyer can open a dispute at any time before completion. The arbiter can act only on disputed trades.
- Pact managed capabilities: one `coin.TRANSFER` per (sender, receiver) per transaction, which the code respects (see `pay-from-trade`).
