#!/bin/bash
# Fresh local chain: Pact 5 server on 4600 with v11 loaded and demo accounts funded, and a Chainweb-shaped
# proxy on 4500 for the site (VITE_CHAINWEB_API=http://127.0.0.1:4500) and its server (ALERTS_CHAIN_API=...).
# Needs the Pact 5.4 binary: PACT_BIN=/path/to/pact (contracts/test/run.sh downloads one into .local/pact/).
set -e
D="$(cd "$(dirname "$0")" && pwd)"
PACT=${PACT_BIN:-$D/../../.local/pact/pact}
cd "$D"
[ -f pact.pid ] && kill $(cat pact.pid) 2>/dev/null || true
[ -f proxy.pid ] && kill $(cat proxy.pid) 2>/dev/null || true
sleep 1
rm -rf log; mkdir -p log
LANG=C.UTF-8 LC_ALL=C.UTF-8 nohup "$PACT" -s config.yaml > server.log 2>&1 &
echo $! > pact.pid
sleep 3
node bootstrap.mjs
nohup node proxy.mjs 4500 > proxy.log 2>&1 &
echo $! > proxy.pid
sleep 1
echo "local chain ready: pact server 4600, proxy 4500"
