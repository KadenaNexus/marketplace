# Local chain for development

`./reset.sh` starts a Pact 5 server with `contracts/p2p-escrow-v11.pact` loaded (demo build: block time comes
from a `demo-now` field in each transaction, because the server has no blocks; coin lets anyone mint), funds the
demo accounts in `keys.json` (generated on first run; demo keys only), and puts a Chainweb-shaped proxy on
port 4500.

Run the site against it:

    VITE_CHAINWEB_API=http://127.0.0.1:4500 VITE_DEMO_TIME=1 npx vite
    ALERTS_CHAIN_API=http://127.0.0.1:4500 node server/index.js

Reads of the pool and trade tables come straight from the real contract, so what you see is what mainnet will do,
except that block time is the transaction's time and there is no mining delay.
