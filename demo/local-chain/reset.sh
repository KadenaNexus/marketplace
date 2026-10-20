#!/bin/bash
# Fresh local chains: one Pact 5 server per escrow v11 chain (chain 1 on 4600, chain 2 on 4601) with v11 loaded and
# the demo accounts funded on each, and a Chainweb-shaped proxy on 4500 that sends /chain/<n>/ to chain n's server,
# for the site (VITE_CHAINWEB_API=http://127.0.0.1:4500) and its server (ALERTS_CHAIN_API=...).
# LOCAL_CHAINS="1" keeps the old single-chain setup. Needs the Pact 5.4 binary: PACT_BIN=/path/to/pact
# (contracts/test/run.sh downloads one into .local/pact/).
set -e
D="$(cd "$(dirname "$0")" && pwd)"
PACT=${PACT_BIN:-$D/../../.local/pact/pact}
PACT_PORT=${PACT_PORT:-4600}; PROXY_PORT=${PROXY_PORT:-4500}
LOCAL_CHAINS=${LOCAL_CHAINS:-"1 2"}
ROUTES=""
for CHAIN in $LOCAL_CHAINS; do
  PORT=$((PACT_PORT + CHAIN - 1))
  WORK=${CHAIN_DIR:-$D/run}-$PORT; mkdir -p "$WORK"
  ( cd "$WORK"
    [ -f pact.pid ] && kill $(cat pact.pid) 2>/dev/null || true
    sleep 1
    rm -rf log; mkdir -p log
    sed "s/^port: .*/port: $PORT/" "$D/config.yaml" > config.yaml
    LANG=C.UTF-8 LC_ALL=C.UTF-8 nohup "$PACT" -s config.yaml > server.log 2>&1 &
    echo $! > pact.pid )
  ROUTES="$ROUTES${ROUTES:+,}$CHAIN=$PORT"
done
sleep 3
for CHAIN in $LOCAL_CHAINS; do
  PACT_SERVER=http://127.0.0.1:$((PACT_PORT + CHAIN - 1)) CHAIN_ID=$CHAIN DEMO_KEYS=${DEMO_KEYS:-$D/keys.json} node "$D/bootstrap.mjs"
done
PROXY_DIR=${CHAIN_DIR:-$D/run}-$PROXY_PORT; mkdir -p "$PROXY_DIR"
[ -f "$PROXY_DIR/proxy.pid" ] && kill $(cat "$PROXY_DIR/proxy.pid") 2>/dev/null || true
nohup node "$D/proxy.mjs" $PROXY_PORT "$ROUTES" > "$PROXY_DIR/proxy.log" 2>&1 &
echo $! > "$PROXY_DIR/proxy.pid"
sleep 1
echo "local chains ready: $ROUTES (chain=pact port), proxy $PROXY_PORT"
