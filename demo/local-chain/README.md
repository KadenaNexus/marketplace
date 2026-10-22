# Local chain for development

`./reset.sh` starts one Pact 5 server per escrow v11 chain (chain 1 on port 4600, chain 2 on 4601), each with
`contracts/p2p-escrow-v11.pact` loaded (demo build: block time comes from a `demo-now` field in each transaction,
because the server has no blocks; coin lets anyone mint), funds the demo accounts in `keys.json` on both (generated
on first run; demo keys only), and puts a Chainweb-shaped proxy on port 4500 that sends `/chain/<n>/` to chain n's
server. A path without a chain (the bare base below) goes to chain 1. `LOCAL_CHAINS="1" ./reset.sh` runs chain 1 only.

Run the site against it:

    VITE_CHAINWEB_API=http://127.0.0.1:4500 VITE_DEMO_TIME=1 npx vite
    ALERTS_CHAIN_API=http://127.0.0.1:4500 node server/index.js

Auto-release (server/autoRelease.js) works locally too. `reset.sh` creates a demo release agent (`agent` in
`keys.json`), funds it and names it with `set-agent` on each chain. Run the mock TronGrid (local testing only) and give
the server the agent's secret:

    node demo/local-chain/mock-tron.mjs 4700
    ALERTS_CHAIN_API=http://127.0.0.1:4500 VITE_DEMO_TIME=1 TRONGRID_API=http://127.0.0.1:4700 AUTO_RELEASE_INTERVAL_MS=5000 \
      AUTO_RELEASE_SECRET=$(node -p 'require("./demo/local-chain/keys.json").agent.secretKey') node server/index.js

Post a USDT pool on Tron with "Auto-release" on, take it as the buyer, and note the exact amount the trade asks for
(e.g. 0.533017). Then fake the payment to the seller's receiving address:

    curl -X POST http://127.0.0.1:4700/transfers -H 'content-type: application/json' -d '{"to":"T…","amount":"0.533017"}'

Within a round or two the agent releases and the trade is COMPLETED. Ethereum is not mocked (it needs ETHERSCAN_API_KEY).

Reads of the pool and trade tables come straight from the real contract, so what you see is what mainnet will do,
except that block time is the transaction's time and there is no mining delay. The two chains have separate tables,
so the same pool or trade id can exist on both, as on mainnet. The Kadena tokens (BRO, FLUX, kb-USDC, kb-ETH,
kb-USDT) are not deployed locally, so instant swaps cannot be tried here; USDT/USDC pools and giveaways can.
