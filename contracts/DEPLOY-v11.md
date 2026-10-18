# Deploying escrow v11 (chains 1 and 2)

The same contract goes on **chain 1** and **chain 2** of Kadena mainnet as `free.p2p-escrow-v11`.

- **Chain 1:** USDT, USDC, BRO and FLUX pools.
- **Chain 2:** kb-USDC, kb-ETH and kb-USDT pools.

You deploy it from Chainweaver with the same two wallets that govern v10. It takes two transactions, one per chain, and each costs well under 0.001 KDA in gas.

## Checked against the live chain on 2026-10-18 (simulation, nothing sent)

| | Chain 1 | Chain 2 |
|---|---|---|
| Name `free.p2p-escrow-v11` free | yes | yes |
| Deploy + tables + config in one transaction | **Write succeeded**, 45,201 gas | **Write succeeded**, 45,223 gas |
| Gas payer `k:18368d2e…004e` has KDA | yes (71.8 KDA) | **no account yet**, so do step 1 first |
| Arbiter / fee account exists | yes | yes |

- **Governance:** the same keys as v10, read from the chain's `free.p2p-escrow-v10-gov` keyset, with predicate `keys-all` (both must sign):
  - `18368d2ea6b9d841df566cbe5ea21b7bc1bae00c8059165fa0c5854de33c004e`
  - `5c0d1f9475a020900be831b6bd7d1c234e430bc6491ef2e415ffdff1a71b2f2b`
- **Arbiter:** the same as v10, `k:eda1ef1f1528f5f72e153fcb9c2c8178317749429bd48aaf34b6b52fa16598e1`.
- **Fee:** 0% at launch. The fee account is set to the arbiter account for now and can be changed later with `set-fee`.

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

## Step 4: send me the two request keys

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
