#!/usr/bin/env bash
# One-time setup of https://marketplace-advanced.kadena.ws (the v11 preview) on the Kadena Nexus server.
#
#   sudo bash deploy/staging/setup.sh <app-user> [path-to-the-live-marketplace-.env]
#
# <app-user>  the Linux account that runs the existing PM2 apps (it will own the clone and the API process).
# The optional .env path lets the preview reuse, on this server, the live site's email (Resend), web-push (VAPID)
# and WalletConnect settings. Only those lines are copied; nothing is printed.
#
# Safe to run again: every step checks what already exists. It does not touch marketplace.kadena.ws,
# its database, its PM2 processes or its nginx file.
set -euo pipefail
umask 022

DOMAIN=marketplace-advanced.kadena.ws
REPO_SSH=git@github-marketplace-advanced:KadenaNexus/marketplace-advanced.git
API_PORT=5060
PM2_NAME=kadena-advanced-server
DB_NAME=kadena_advanced
DB_USER=kadena_advanced
PGPORT=${PGPORT:-5432}
WEB_ROOT=/var/www/$DOMAIN
HERE=$(cd "$(dirname "$0")" && pwd)

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run with sudo."
APP_USER=${1:-}; PROD_ENV=${2:-}
[ -n "$APP_USER" ] && id "$APP_USER" >/dev/null 2>&1 || die "give the PM2 account as the first argument, e.g. sudo bash $0 mustafa"
APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)
APP_DIR=$APP_HOME/apps/marketplace-advanced
as_app() { sudo -u "$APP_USER" -H bash -lc "$1"; }

say "Checks"
for c in nginx certbot psql curl git openssl ss visudo; do command -v "$c" >/dev/null || die "$c is not installed."; done
as_app "command -v node >/dev/null && command -v npm >/dev/null && command -v pm2 >/dev/null" || die "node, npm or pm2 is missing for $APP_USER."
id deployer >/dev/null 2>&1 || die "the deployer account (used by GitHub Actions) does not exist."
dns=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
mine=$(curl -s -4 -m 10 https://api.ipify.org || true)
[ -n "$dns" ] || die "$DOMAIN has no DNS record yet. In GoDaddy add: A record, name marketplace-advanced, value ${mine:-the IP of this server}."
[ -z "$mine" ] || [ "$dns" = "$mine" ] || die "$DOMAIN points to $dns, but this server is $mine."
if ss -ltn "( sport = :$API_PORT )" | grep -q LISTEN && ! as_app "pm2 describe $PM2_NAME >/dev/null 2>&1"; then
  die "port $API_PORT is already used by something else. Edit API_PORT here and in the nginx file."
fi
echo "ok: tools, DNS ($dns), port $API_PORT"

say "Read-only GitHub access for the private repository"
KEY=$APP_HOME/.ssh/marketplace_advanced_deploy
if [ ! -f "$KEY" ]; then
  as_app "install -d -m 700 ~/.ssh && ssh-keygen -q -t ed25519 -N '' -C 'marketplace-advanced preview (read-only)' -f '$KEY'"
fi
if ! grep -q "Host github-marketplace-advanced" "$APP_HOME/.ssh/config" 2>/dev/null; then
  as_app "printf '\nHost github-marketplace-advanced\n  HostName github.com\n  User git\n  IdentityFile $KEY\n  IdentitiesOnly yes\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config"
fi
# GitHub's published SSH host key (docs.github.com > GitHub's SSH key fingerprints), pinned rather than fetched.
GH_HOSTKEY="github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl"
as_app "grep -qF '$GH_HOSTKEY' ~/.ssh/known_hosts 2>/dev/null || echo '$GH_HOSTKEY' >> ~/.ssh/known_hosts"
until as_app "git ls-remote '$REPO_SSH' HEAD >/dev/null 2>&1"; do
  echo
  echo "Add this key on GitHub: KadenaNexus/marketplace-advanced > Settings > Deploy keys > Add deploy key."
  echo "Title: preview server. Leave \"Allow write access\" UNTICKED."
  echo
  cat "$KEY.pub"
  echo
  read -r -p "Press Enter once it is added (Ctrl-C to stop)... " _
done
echo "ok: the server can read the repository"

say "Code"
if [ ! -d "$APP_DIR/.git" ]; then
  as_app "mkdir -p '$(dirname "$APP_DIR")' && git clone --quiet --branch main '$REPO_SSH' '$APP_DIR'"
fi
as_app "cd '$APP_DIR' && git fetch --quiet origin main && git -c advice.detachedHead=false checkout --quiet --force origin/main"
echo "ok: $APP_DIR at $(as_app "cd '$APP_DIR' && git rev-parse --short HEAD")"

say "Database (its own; the live marketplace database is not used)"
psqlp() { sudo -u postgres psql -X -q -p "$PGPORT" -v ON_ERROR_STOP=1 "$@"; }
DB_PASS_FILE=/root/.marketplace-advanced-db
if ! psqlp -d postgres -Atc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  DB_PASS=$(openssl rand -hex 24)
  psqlp -d postgres -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS'"
  ( umask 077; printf '%s\n' "$DB_PASS" > "$DB_PASS_FILE" )
fi
psqlp -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || psqlp -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
echo "ok: database $DB_NAME on port $PGPORT"

say "Settings (.env, readable only by $APP_USER)"
ENV=$APP_DIR/.env
if [ ! -f "$ENV" ]; then
  [ -f "$DB_PASS_FILE" ] || die "the database role exists but its password is not in $DB_PASS_FILE. Set DATABASE_URL in $ENV by hand."
  DB_PASS=$(cat "$DB_PASS_FILE")
  tmp=$(mktemp)
  cat > "$tmp" <<EOF
# marketplace-advanced.kadena.ws (v11 preview). Created by deploy/staging/setup.sh. Never commit this file.
PORT=$API_PORT
HOST=127.0.0.1
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:$PGPORT/$DB_NAME
CORS_ORIGINS=https://$DOMAIN
ALERTS_PUBLIC_URL=https://$DOMAIN
SESSION_SECRET=$(openssl rand -hex 32)
V11_CHAINS=1,2

VITE_STAGING=1
VITE_PROFILE_API=
VITE_CHAINWEB_API=https://api.chainweb-community.org/chainweb/0.0/mainnet01/chain/1/pact
VITE_CONTRACT_NAMESPACE=free
VITE_CONTRACT_MODULE=p2p-escrow-v10
VITE_CONTRACT_MODULE_V11=p2p-escrow-v11
VITE_V11_CHAINS=1,2

# Auto-release stays off until the agent key is made here (docs/AUTO-RELEASE-SETUP.md):
#   node server/scripts/new-agent-key.mjs .env
EOF
  if [ -n "$PROD_ENV" ]; then
    [ -f "$PROD_ENV" ] || die "$PROD_ENV not found."
    printf '\n# Copied from the live site on this server\n' >> "$tmp"
    grep -E '^(RESEND_API_KEY|VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|VAPID_SUBJECT|VITE_WALLETCONNECT_PROJECT_ID)=' "$PROD_ENV" >> "$tmp" || true
  fi
  install -o "$APP_USER" -g "$APP_USER" -m 600 "$tmp" "$ENV"
  rm -f "$tmp"
  echo "ok: created $ENV"
else
  echo "ok: $ENV already exists (left as it is)"
fi

say "First build"
as_app "cd '$APP_DIR' && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent"
rm -rf "$WEB_ROOT.new"; cp -a "$APP_DIR/dist" "$WEB_ROOT.new"; chown -R root:root "$WEB_ROOT.new"; chmod -R a+rX,go-w "$WEB_ROOT.new"
rm -rf "$WEB_ROOT"; mv "$WEB_ROOT.new" "$WEB_ROOT"
echo "ok: site files in $WEB_ROOT"

say "API process (PM2: $PM2_NAME)"
if as_app "pm2 describe $PM2_NAME >/dev/null 2>&1"; then
  as_app "pm2 restart $PM2_NAME --update-env >/dev/null"
else
  as_app "cd '$APP_DIR' && pm2 start server/index.js --name $PM2_NAME --cwd '$APP_DIR' --time >/dev/null"
fi
as_app "pm2 save --force >/dev/null"
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/profiles" || true)
  [ "$code" != 000 ] && [ "$code" -lt 500 ] && break
  sleep 2
done
[ "$code" != 000 ] && [ "$code" -lt 500 ] || die "the API did not start. See: sudo -u $APP_USER pm2 logs $PM2_NAME --lines 50"
echo "ok: API answers on 127.0.0.1:$API_PORT"

say "nginx and HTTPS"
# certbot adds the HTTPS block to this file, so a re-run must not overwrite it.
[ -f "/etc/nginx/sites-available/$DOMAIN" ] || install -m 644 "$HERE/nginx-$DOMAIN.conf" "/etc/nginx/sites-available/$DOMAIN"
ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t && systemctl reload nginx
[ -d "/etc/letsencrypt/live/$DOMAIN" ] || certbot --nginx -d "$DOMAIN" --redirect --non-interactive --quiet
nginx -t && systemctl reload nginx
echo "ok: https://$DOMAIN"

say "Deploys from GitHub"
cat > /etc/marketplace-advanced.conf <<EOF
# Read by /usr/local/bin/deploy-marketplace-advanced. Created by deploy/staging/setup.sh.
APP_USER=$APP_USER
APP_DIR=$APP_DIR
WEB_ROOT=$WEB_ROOT
PM2_NAME=$PM2_NAME
API_PORT=$API_PORT
DOMAIN=$DOMAIN
EOF
chmod 644 /etc/marketplace-advanced.conf
install -o root -g root -m 755 "$HERE/deploy-marketplace-advanced" /usr/local/bin/deploy-marketplace-advanced
SUDOERS=/etc/sudoers.d/deployer-marketplace-advanced
echo "deployer ALL=(root) NOPASSWD: /usr/local/bin/deploy-marketplace-advanced" > "$SUDOERS.tmp"
chmod 440 "$SUDOERS.tmp"
visudo -cf "$SUDOERS.tmp" >/dev/null && mv "$SUDOERS.tmp" "$SUDOERS"
/usr/local/bin/deploy-marketplace-advanced

say "Done"
echo "https://$DOMAIN is up. Merges to main of KadenaNexus/marketplace-advanced now deploy here."
echo "Auto-release stays off until: cd $APP_DIR && sudo -u $APP_USER node server/scripts/new-agent-key.mjs .env"
