# Advanced Marketplace on escrow v11 – site specification

This is the contract between the chain library (`src/lib/v11.ts`), the server (`server/`) and the UI.
The Pact contract is `contracts/p2p-escrow-v11.pact`; read its header for the money paths.

## Vocabulary

| v10 word | v11 word | Meaning |
|---|---|---|
| offer / escrow | **pool** (on chain: `offer`) | What a creator posts: a total with a min/max per trade. SELL pools hold KDA in the pool vault. |
| accepted trade | **trade** | A slice someone took. Starts **FUNDED**. Has its own vault, clock and chat. |
| accept + deposit | **take** | One tap. `take-offer` (paid outside Kadena) or `take-and-settle` (instant, Kadena token). |

Trade states: `FUNDED → PAID → COMPLETED`, plus `CANCELLED` (buyer, before paying), `REFUNDED` (seller after the
payment window, or arbiter), `DISPUTED → COMPLETED | REFUNDED | SPLIT`. Instant trades and giveaways are created
directly as `COMPLETED`.

Pool states: `OPEN | CLOSED`. A pool with `available < min` is open but has nothing to take; the UI hides it from
the market and shows it to its creator with top-up / close.

## Chains: the currency decides the chain

The same contract, `free.p2p-escrow-v11` with the same governance, is deployed on **chain 1 and chain 2**. One table,
`shared/v11-chains.js`, read by the site (`src/lib/markets.ts`, `src/lib/v11.ts`) and the server (`server/chain.js`,
`server/tokens.js`), says which chain each currency is on:

| Chain | Currency | Kind | Module (fungible-v2) | Precision |
|---|---|---|---|---|
| 1 | USDT | paid outside Kadena (TRC20, ERC20) | – | – |
| 1 | USDC | paid outside Kadena (ERC20) | – | – |
| 1 | BRO | instant | `n_582fed11af00dc626812cd7890bb88e72067f28c.bro` | 12 |
| 1 | FLUX | instant | `runonflux.flux` | 8 |
| 2 | kb-USDC | instant | `n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDC` | 6 |
| 2 | kb-ETH | instant | `n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-ETH` | 18 |
| 2 | kb-USDT | instant | `n_e595727b657fbbb3b8e362a05a7bb8d12865c1ff.kb-USDT` | 6 |

Modules and precisions were checked on mainnet01 on 2026-10-18 (`n_e595….BRO` / `….FLUX` are router adapters, not
tokens). A giveaway (`currency` "FREE") is posted on chain 1. These 7 are the only payment methods (no Wise, Revolut or
fiat in v11). A pool read from a chain whose currency/token does not match the table (e.g. a module calling itself
"kb-USDC") is not listed in the market (`fitsTable`); its creator still sees it.

**Pools and trades are identified by (chain, id).** Off chain they are written as one reference: `2:<id>` on chain 2,
the bare id on chain 1 (a chain-1 id that itself starts with `<digits>:` is written `1:<id>`). The reference is what
`Pool.poolId` / `Trade.tradeId` / `Trade.poolId` hold in the site and the server, so React keys, query caches, the
server's tables (`pool_details`, `trade_states`, `trade_txs`, notifications, chat…) and links never mix the same id on
two chains, and rows and links from before chain 2 (bare ids) stay chain 1. Links: `/?offer=2:trade-…` (or
`?pool=2:pool-…`); `/?offer=trade-…` means chain 1. Every reader and builder takes a reference and works on its chain
(`setMeta chainId`); `submitTransaction` sends to the command's chain and `pollTransaction` polls it there.

New pool: `newPoolId(chainForCurrency(currency))`; a take: `newTradeId(pool.chain)`. The form shows the KDA on that
chain ("Chain 2: … KDA") and, when it is too low, says the KDA must be on chain 2 and can be moved there in Linx Wallet.
Instant payments are `tokenPayFor(amount, price, precision)`: amount × price rounded **up** to the token's precision,
computed exactly (BigInt) and sent as a decimal string (kb-ETH has 18 decimals).

Server: `V11_CHAINS` (default `1,2`) is the list of chains `server/chain.js` reads, one after the other. `fetchChain()`
returns `{ pools, trades, config, configs }` (`config` = the first chain's, `configs[chain]` each chain's; arbiter and
release window are taken per trade from its chain). A chain where the contract is not deployed yet counts as empty.
`server/tradeTxs.js` accepts v10 on chain 1 and v11 on any of `V11_CHAINS`, and polls each transaction on its chain.
Token prices (`server/tokens.js`): Mercatus (`kaddex.exchange`, chain 2 only) for BRO, FLUX, kb-USDC, kb-ETH;
kb-USDT has no pool there and falls back to the USD price (marked fallback).

## On-chain records (from `get-offer` / `get-trade`)

Pool: `creator side available locked min max price currency token pay-window expires-at agent state created-at takes`
Trade: `offer seller buyer amount price currency token pay-amount fee pay-window agent state funded-at paid-at closed-at`

Numbers arrive as JSON numbers or `{int}` / `{decimal}`; times as `{timep}`/`{time}`/ISO, EPOCH = not set.

## Payment methods (replaces Wise/Revolut/bank)

- **USDT** on Tron (TRC20) or Ethereum (ERC20); **USDC** on Ethereum (ERC20). `currency` = `"USDT"` / `"USDC"`,
  `token` = `""`. The network and the seller's receiving address live off chain (server, per pool, see below).
  Trade flow: take → buyer sends → (agent verifies and releases) or buyer marks paid and seller releases.
- **Kadena tokens, instant:** `currency` = symbol, `token` = module name. Trade flow: `take-and-settle`, done.
  BRO and FLUX on chain 1; kb-USDC, kb-ETH, kb-USDT on chain 2 (table above, `KADENA_TOKENS` in `src/lib/markets.ts`).
- **Giveaway:** SELL, `price` 0, `token` "". One tap, completes on take.

## Off-chain data the server keeps per pool (`pool_details`, keyed by pool reference)

`creator, networks (JSON: e.g. ["USDT:TRC20","USDC:ERC20"]), payout (JSON: {"USDT:TRC20": "T...", ...}),
notes, created_at`. Price and currency are on chain now, so `offer_details.price` is no longer the source of truth.
Payout addresses are shown to a buyer only after they took a slice (same rule as today's PayoutCard).

## Chain library (`src/lib/v11.ts`)

Types: `Pool`, `Trade` (with `tradeId`), `TradeState`, `PoolState`; both carry `chain`, and their ids are references.
Readers: `readPools()` (one local call per chain), `readPool(ref)`, `readTrades()` (one local call per chain, all),
`readActiveTradeIds()`, `readTrade(ref)`, `readConfig(chain?)`, `readConfigs()`, `readReputation(wallet)` (summed over
the chains), `poolVault(ref)`, `tradeVault(ref)`, `tokenPrecision(module, chain)`, `tokenBalance(module, account, chain)`.
Builders (each returns an unsigned command; signer caps are exactly these):
- `buildCreatePoolTx(p)`: GAS, ACCOUNT_AUTH creator, and for SELL `coin.TRANSFER creator poolVault total`.
- `buildTopUpTx`, `buildWithdrawTx`, `buildUpdatePoolTx`, `buildClosePoolTx`: GAS, ACCOUNT_AUTH creator (+ TRANSFER for top-up).
- `buildTakeTx(tradeId, poolId, taker, amount, side)`: GAS, ACCOUNT_AUTH taker; BUY pools also `coin.TRANSFER taker tradeVault amount`.
- `buildTakeAndSettleTx(tradeId, poolId, taker, amount, tokenModule, seller, pay)`: GAS, ACCOUNT_AUTH taker,
  `<tokenModule>.TRANSFER taker seller pay` (`pay` = the decimal string from `tokenPayFor`).
- Every builder is built for the chain of the reference it gets; a take refuses a trade reference on another chain.
- `buildMarkPaidTx`, `buildCancelTx` (buyer); `buildReleaseTx` (seller or agent); `buildTimeoutRefundTx` (seller);
  `buildOpenDisputeTx` (buyer or seller); `buildResolveTx(tradeId, toBuyer)` (arbiter).
`tradeToEscrow(trade, pool?)` maps a trade to the legacy `Escrow` shape so chat, proofs, notifications, emails and
the trade timer keep working: `offerId = tradeId`, `creator = pool creator`, `acceptedAt = fundedAt`,
`paymentMethod = JSON ["USDT (TRC20)"]` built from the pool details, `fiatCurrency = currency`.

Trade ids and pool ids are generated by the site like today's offer ids (`offer-<ms>-<rand>` → `pool-…`, `trade-…`),
with `2:` in front on chain 2. The trade code (`tradeCode`) keeps working on either id.

## Server

- `server/chain.js`: `fetchChain()` returns `{ pools, trades, config, configs }` from one local call each per chain in
  `V11_CHAINS` (v11), with the legacy `fetchChainOffers()` kept for v10 history (chain 1; completed counts, ratings).
- Notifications (`eventsForChange`): a trade appearing as FUNDED tells the buyer "send <pay-amount> <currency> to …"
  and the seller "<buyer> took <amount> KDA"; PAID/COMPLETED/REFUNDED/CANCELLED/DISPUTED/SPLIT as today, with the
  agent wording ("released by the agent") when `agent` is set. Deadlines use the trade's own `pay-window` and the
  config `t-release`.
- Offer alerts (new offers by email): a new pool → "Selling 1,000 KDA, 50–500 per trade, 0.01 USDT".
- Trust: completed counts = v11 completed trades + v10 completed trades. New-trader limit (500 KDA) applies per take.
- Hidden offers / admin list: work on pools. The server's auto-expiry job is replaced by the pool's on-chain expiry.
- `/api/pools/:id/details` PUT/GET (creator-authenticated PUT; GET returns payout only to a party of a trade on that pool).

### Server routes (v11), as built in `server/pools.js`, `server/payout.js`, `server/index.js`

Authenticated calls use the usual `wallet, publicKey, signedCmd` (body for PUT/POST, query for GET).

- `GET /api/pools` → `[{ poolId (reference), chain, creator, side, available, locked, min, max, price, currency, token, payWindow, expiresAt?,
  agent, state: "OPEN", createdAt?, takes, networks: string[], notes: string, hidden: { reason, hiddenAt } | null }]`
  (open pools only, cached ~15 s; the UI filters `hidden` for everyone but the creator).
- `GET /api/pools/:poolId/details` → `{ poolId, networks, notes, updatedAt }` (public, never addresses; empty defaults when nothing saved).
- `PUT /api/pools/:poolId/details` body `{ networks: ("USDT:TRC20"|"USDT:ERC20"|"USDC:ERC20")[], payout: { [network]: address }, notes? }`
  → `{ ok, poolId, networks, notes }`. 404 until the pool is on the chain (save it after the create transaction is
  confirmed), 403 unless the wallet is the pool's creator, 400 on a bad address (TRC20 `T…`, ERC20 `0x…`).
- `GET /api/pools/:poolId/payout?wallet=…&publicKey=…&signedCmd=…[&tradeId=…]` → `{ poolId, networks, payout, notes, updatedAt, isMine }`
  for the creator, a buyer/seller of a trade on the pool, or the arbiter; `tradeId` lets a take from seconds ago count.
- `GET /api/offers/:tradeId/payout` (legacy PayoutCard) with a v11 trade id: a trade on a SELL pool answers with the
  pool's addresses as `details: [{ method: "USDT", value, network: "TRC20" }]` (read only); a trade on a BUY pool
  works as in v10 with the taker (KDA holder) saving `details` while the trade is FUNDED.
- `GET /api/offers/:tradeId` with a v11 trade id → the v10 shape plus `v11: true, poolId, seller, buyer, payAmount,
  token, payWindow, agent, state` (price/currency from the chain).
- `GET /api/trades/recent` items carry `token` (module name for an instant swap, else null); `total` is the amount paid
  (0 for a giveaway). The socket event `trade-completed` carries the same item.
- Notification kinds for v11 trades: `funded` (buyer), `taken` (seller), `paid`, `marked`, `completed`, `disputed`,
  `refunded`, `cancelled` (seller only), `split`, `due-pay`, `expired-pay`, `due-release`, `expired-release`;
  `new_offer` items for pools have `offerId = poolId` and `open` true while the pool is OPEN; `expiring-pool-…` a day
  before a pool's on-chain expiry. Hide/relist/admin list (`/api/offers/:id/hide`, `/api/admin/open-offers`) take pool ids.

## UI

- Market: pool cards (available, min–max, price, currency/network chips, "Instant" badge for tokens, seller trust).
  Tap → take sheet: amount input with min/max and quick chips, total to pay, then one button:
  "Buy N KDA" (take) / "Swap now" (take-and-settle) / "Claim" (giveaway).
- New offer: total, min, max, price, currency (USDT, USDC, BRO, FLUX on chain 1; kb-USDC, kb-ETH, kb-USDT on chain 2),
  network for USDT/USDC, receiving address, payment window (15 min–24 h, default 30 min), optional expiry, giveaway
  checkbox. Shows the KDA on the currency's chain.
- Pool cards, the take sheet, My offers and the trade view show the chain discreetly ("Chain 2").
- My offers: each pool with available/locked, top-up, withdraw, edit, close.
- Trade view: states above; buttons by role: buyer → Mark as paid / Cancel / Dispute; seller → Release /
  Refund (after window) / Dispute (after PAID); arbiter → Resolve with a split (admin board).
- Countdown overlay, notifications, chat, proofs, emails, trade feed: unchanged, through `tradeToEscrow`.
