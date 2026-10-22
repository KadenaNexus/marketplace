# Deploying escrow v11 (chains 1 and 2)

**Done on 2026-10-19.** Chain 1: `YTs6LIPeRZnB5GVmnR0Z_19Ii4XeKGLIFkyR75QSxSc`; chain 2: `IXEJiZjNzWxMH9n9H1pk-IT5MptudEKyeHiPYdSMjjQ`. Checked on chain; see `deployed/p2p-escrow-v11.pact`. Still to do: `set-agent` on chain 1 (USDT/USDC pools live there) once the server's release agent exists (docs/AUTO-RELEASE-SETUP.md).

Tip from the deployment: type the gas price and gas limit, then press Tab, and check that Max Transaction Fee shows 0.0006 before Preview.

The same contract goes on **chain 1** and **chain 2** of Kadena mainnet as `free.p2p-escrow-v11`.

- **Chain 1:** USDT, USDC, BRO and FLUX pools.
- **Chain 2:** kb-USDC, kb-ETH and kb-USDT pools.

You deploy it from Chainweaver with the same two wallets that govern v10. It takes two transactions, one per chain, and each costs well under 0.001 KDA in gas.

## Checked against the live chain on 2026-10-18 (simulation, nothing sent; re-run after the release-agent rule)

| | Chain 1 | Chain 2 |
|---|---|---|
| Name `free.p2p-escrow-v11` free | yes | yes |
| Deploy + tables + config in one transaction | **Write succeeded**, 46,171 gas | **Write succeeded**, 46,192 gas |
| Gas payer `k:18368d2e…004e` has KDA | yes (71.8 KDA) | **no account yet**, so do step 1 first |
| Arbiter / fee account exists | yes | yes |

- **Governance:** the same keys as v10, read from the chain's `free.p2p-escrow-v10-gov` keyset, with predicate `keys-all` (both must sign):
  - `18368d2ea6b9d841df566cbe5ea21b7bc1bae00c8059165fa0c5854de33c004e`
  - `5c0d1f9475a020900be831b6bd7d1c234e430bc6491ef2e415ffdff1a71b2f2b`
- **Arbiter:** the same as v10, `k:eda1ef1f1528f5f72e153fcb9c2c8178317749429bd48aaf34b6b52fa16598e1`.
- **Fee:** 0% at launch. The fee account is set to the arbiter account for now and can be changed later with `set-fee`.

## Upgrade 1 (2026-10-20): internal helpers locked down

The deployed module let anyone call `pay-from-trade`, `return-from-trade`, `settle-locked` and `bump` directly (no
signature), so any open trade's KDA could be moved to any account. `contracts/deploy/upgrade-v11.pact` is the fixed
module, revision 2 after an outside review (sha256 7d9c064b…1627; dry run on both chains: "Loaded module", 47,338 gas).
It also:
- stops a revoked agent from releasing, including trades that were already open;
- runs instant-swap token modules without the internal capability, so a token that calls back cannot reach the
  helpers (mainnet dry run: refused with "INTERNAL has not been granted"; before, only the Pact runtime stopped it);
- settles split disputes when the fee account is the seller; caps an instant payment at the amount due rounded up;
- lets the seller dispute as soon as the buyer marks paid (the old extra condition never did anything);
- gives an open BUY offer its capacity back after a cancel or timeout;
- accepts a w: multi-signature account as arbiter; validates `set-fee` / `set-arbiter`; fixes `take-and-settle` when the
  taker is the fee account.

**After deploying, check the module hash on both chains** (Chainweaver → Contracts → module explorer, or ask me): it must
be `R3ER6cBjt19Xu7qTps_qP3LDQTBje4RYH22KsVE3LFc`. The code live before the upgrade has hash
`1H3wF77L8mzzN3jeo8Z4yXhBUqdPmoi8C02t8pxWIyg`.

Deploy it on **chain 1 and then chain 2** exactly like the first deployment (same gov-keyset, both signers, gas limit
60000, gas price 0.00000001), with these differences:
- Use `contracts/deploy/upgrade-v11.pact`. It has **no** create-table or init-config lines (the tables exist).
- Before sending, make sure there are **no open pools or trades** on that chain (`list-offer-ids`, `list-active-trade-ids`),
  or at least that every open trade is one you control. Open trades survive the upgrade unchanged; closing them first
  only removes the window while the old code is live.
- Preview must say **Write succeeded** / "Loaded module free.p2p-escrow-v11". Then send me both request keys.

## Upgrade 2 (revision 3, 2026-10-22): grace period, approved tokens, free takes

File: `contracts/deploy/upgrade-v11-rev3.pact` (sha256 `56218c17…f6ea`). Mainnet dry run on both chains: success, about
67,500 gas. It upgrades `free.p2p-escrow-v11` in place (open trades and vaults are unchanged, tested from the live
revision-2 code with funded, paid and disputed trades) and adds:
- **Grace period:** after a trade's payment window the buyer has 30 more minutes to tap I paid or open a dispute; the
  seller can take the KDA back only after that. Trades already open get it too.
- **Approved tokens:** instant swaps only in tokens governance approved (`set-token`). The file approves BRO and FLUX on
  chain 1, kb-USDC, kb-ETH and kb-USDT on chain 2 (the site's list).
- **Free takes:** a new module `free.p2p-escrow-v11-gas` (a gas station) pays the gas when a buyer with no KDA takes a
  USDT/USDC SELL pool, and that buyer's I paid, Cancel or Open dispute on the trade. Limits: per day overall and per
  buyer (set by governance), at most 3 per pool per day, a largest free slice, and the station pays at most 4
  transactions per free take per day, each at most 0.00002 KDA. It stays **off** until step 4 below.
- `take-and-settle` writes the trade before calling the token (hardening from the independent review).

After deploying, the module hashes must be: escrow `pIbMOO3bUcA-XA0xMpSw0jc0j9x6JrCmQPdJMw49FYg`, station
`HzkqB6cj1yRnNr1I1OM43iw6Scux9px9lnBH1-4NQLM` (revision 2 was `R3ER6cBjt19Xu7qTps_qP3LDQTBje4RYH22KsVE3LFc`).

1. **Deploy on chain 1, then chain 2**, like revision 2 (gov-keyset with both keys, keys-all; both signers unrestricted;
   gas payer `k:18368d2e…004e`), but with **gas limit 100000**. Preview must say Write succeeded. Right before
   sending, ask me to confirm `free.p2p-escrow-v11-gas` is still unused (anyone can claim a `free.` name first; if
   someone did, the whole upgrade fails and nothing changes).
2. **Deploy the site** (the pull request with the grace period and free takes) right after both chains are done.
3. **Fund the station on chain 1** with 2 KDA, one transaction from `k:18368d2e…004e` (signer unrestricted, gas limit 5000):

       (coin.transfer-create "k:18368d2ea6b9d841df566cbe5ea21b7bc1bae00c8059165fa0c5854de33c004e" (free.p2p-escrow-v11-gas.account) (free.p2p-escrow-v11-gas.create-gas-payer-guard) 2.0)

   The station's account is `u:free.p2p-escrow-v11-gas.gas-payer-guard:DldRwCblQ7Loqy6wYJnaodHl30d3j3eH-qtFzfEv46g`.
4. **Turn free takes on (chain 1)**, signed by both governance keys, gas limit 5000. Suggested start: 50 free takes a
   day, 2 per buyer, up to 200 KDA each:

       (free.p2p-escrow-v11.set-sponsorship (free.p2p-escrow-v11-gas.account) 50 2 200.0)

   Off at any time: `(free.p2p-escrow-v11.set-sponsorship "" 0 0 0.0)` (the station then pays nothing at all).
   Chain 2 has only instant token pools, so it gets no free takes.
5. **Check before telling anyone:** `node contracts/deploy/check-free-take.mjs 1 <an open USDT pool id>`
   simulates a free take for a brand-new wallet on mainnet (nothing is sent). It must print OK. If not, turn free
   takes off (step 4) and send me the output.

## Before you start

- Mica has reviewed the contract. A deployed module can be upgraded by governance, but its tables and trades stay, so treat this as final.
- Use the file `contracts/deploy/deploy-v11.pact`. It is the contract plus five setup lines at the end: four `create-table` calls and `init-config`. Don't edit it.

## Step 1: put a little KDA on chain 2 (once)

In Chainweaver, send **1 KDA** from `k:18368d2e…004e` on **chain 1** to the **same account** on **chain 2**. That is a cross-chain transfer; Chainweaver does both halves. When it finishes, the account shows a balance on chain 2.

## Step 2: deploy on chain 1

1. Open Chainweaver, go to **Contracts**, and paste the whole of `deploy-v11.pact` into the editor.
2. Press **Deploy**.
3. **Configuration** tab:
   - Chain **1**
   - Transaction sender (gas payer) `k:18368d2e…004e`
   - Gas limit **60000**
   - Gas price **0.00000001**
4. **Keysets** tab: create a keyset named exactly **`gov-keyset`**, add both keys above, and set predicate **keys-all**.
5. **Signers** tab: tick **both** keys and leave them unrestricted (no capabilities).
6. **Preview:** it must say **Write succeeded**. If it says anything else, stop and send me a screenshot.
7. Submit, and copy the **request key**.

## Step 3: deploy on chain 2

Repeat step 2 with **Chain 2**. Everything else is the same.

## Step 4: set the release agent (chain 1, once the agent key exists)

Auto-release for USDT/USDC needs the platform's release agent named in the contract. Only governance can do this, and offers can name no other agent; this is what stops someone naming an account of their own.

In Chainweaver, run this on **chain 1**, signed by **both** governance keys, with gas payer `k:18368d2e…004e` and gas limit 5000. Use the agent account I give you (public, starts with `k:`):

    (free.p2p-escrow-v11.set-agent "k:<agent account>")

Chain 2 has only instant token pools, so it needs no agent. You can turn auto-release off at any time with `(free.p2p-escrow-v11.set-agent "")`; trades that are already open keep the agent they started with.

## Step 5: send me the request keys

I will then:
- check on both chains that the module, tables and config are exactly as above;
- copy the deployed file to `contracts/deployed/p2p-escrow-v11.pact` with the request keys and date;
- switch the site to v11 on both chains.

v10 keeps running for its open trades and history; nothing about it changes.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Keyset failure" | Both keys must be ticked as signers, and the keyset must be named `gov-keyset`. |
| "Failed to buy gas" on chain 2 | Step 1 isn't finished. Wait for the cross-chain transfer to complete. |
| "Gas limit exceeded" | Raise the gas limit to 80000. |
| "already exists" | The transaction went through before. Don't retry; send me the request key. |
