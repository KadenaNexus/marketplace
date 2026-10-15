#!/bin/bash
# Runs the v11 contract tests with Pact 5.4. Downloads the interpreter into .local/ on first run.
set -e
cd "$(dirname "$0")"
PACT=${PACT_BIN:-../../.local/pact/pact}
if [ ! -x "$PACT" ]; then
  mkdir -p ../../.local/pact
  curl -fsSL https://github.com/kadena-io/pact-5/releases/download/5.4/pact-5.4-linux-x64.tar.gz | tar xz -C ../../.local/pact
fi
export LANG=C.UTF-8 LC_ALL=C.UTF-8
out=$("$PACT" p2p-escrow-v11.repl 2>&1)
echo "$out" | grep -E "FAILURE|Load failed|error" && { echo "$out"; exit 1; }
echo "$out" | grep -q "v11 tests passed" && echo "v11 tests passed ($(grep -c '(expect' p2p-escrow-v11.repl) checks)"
