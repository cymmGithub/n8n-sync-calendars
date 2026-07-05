#!/bin/bash
set -euo pipefail

# Disaster recovery: rebuild the whole stack on a fresh machine from
# GitHub (code) + BorgBase (state). See docs/backup.md.
#
# Prerequisites on the new machine:
#   - docker (with compose plugin), borg, git
#   - secrets from Bitwarden note "VPS mikrus DR":
#       export BORG_REPO='ssh://fwk3187c@fwk3187c.repo.borgbase.com/./repo'
#       export BORG_PASSPHRASE='...'
#       export BORG_RSH='ssh -i /path/to/borgbase_vps -o StrictHostKeyChecking=accept-new'
#     (or place them in ~/.borg-backup.env)
#
# Usage: disaster-recovery.sh [archive-name]     default: latest archive
#
# Note: only archives created by scripts/vps-backup.sh (2026-07 onward,
# containing backups/*.tar) are supported. The three backup-2025-12-* archives
# use the older whole-project layout.

REPO_URL="https://github.com/cymmGithub/n8n-sync-calendars.git"
# Volumes/containers must be named sync-calendars_* regardless of the
# directory this repo was cloned into. Overridable so a rehearsal can run
# side-by-side with an existing deployment (COMPOSE_PROJECT_NAME=dr-rehearsal).
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-sync-calendars}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
fail() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 1; }
step() { echo -e "${YELLOW}==> $1${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }

step "Preflight checks"
[ -f "$HOME/.borg-backup.env" ] && source "$HOME/.borg-backup.env"
[ -n "${BORG_REPO:-}" ] || fail "BORG_REPO not set (see Bitwarden note 'VPS mikrus DR')"
[ -n "${BORG_PASSPHRASE:-}" ] || fail "BORG_PASSPHRASE not set"
export BORG_REPO BORG_PASSPHRASE BORG_RSH="${BORG_RSH:-ssh -o StrictHostKeyChecking=accept-new}"
for tool in docker borg git curl; do
    command -v "$tool" >/dev/null || fail "$tool not installed"
done
docker compose version >/dev/null 2>&1 || fail "docker compose plugin missing"
ok "tools present, borg env set"

step "Getting the code"
if [ ! -f compose.yaml ]; then
    git clone "$REPO_URL"
    cd "$(basename "$REPO_URL" .git)"
fi
ok "repo at $(pwd)"

step "Picking archive"
ARCHIVE="${1:-$(borg list --short "$BORG_REPO" | tail -n1)}"
[ -n "$ARCHIVE" ] || fail "no archives found in $BORG_REPO"
ok "archive: $ARCHIVE"

step "Extracting state from BorgBase"
borg extract "::$ARCHIVE"
[ -f backups/n8n_data.tar ] || fail "backups/n8n_data.tar missing — old archive layout? Use an archive created by vps-backup.sh"
[ -f .env ] || fail ".env missing from archive"
ok "extracted: backups/*.tar, .env, workflows/"

step "Restoring docker volumes"
for vol in n8n_data redis_data; do
    docker volume create "${COMPOSE_PROJECT_NAME}_${vol}" >/dev/null
    docker run --rm \
        -v "${COMPOSE_PROJECT_NAME}_${vol}:/volume" \
        -v "$(pwd)/backups:/backup" \
        alpine:latest sh -c "find /volume -mindepth 1 -delete && tar xf /backup/${vol}.tar -C /volume"
    ok "volume ${COMPOSE_PROJECT_NAME}_${vol}"
done

step "Starting the stack"
docker compose up -d --build

step "Health checks"
for i in $(seq 1 60); do
    curl -sf -o /dev/null http://localhost:5678/ && break
    [ "$i" -eq 60 ] && fail "n8n did not respond on :5678 within 120s (docker compose logs n8n)"
    sleep 2
done
ok "n8n answers on :5678"
[ "$(docker compose exec -T redis redis-cli ping)" = "PONG" ] || fail "redis does not PONG"
ok "redis PONG, $(docker compose exec -T redis redis-cli dbsize | tr -d '\r') keys"
docker compose ps

rm -f backups/*.tar

echo
echo -e "${GREEN}=== Restore complete (archive: $ARCHIVE) ===${NC}"
echo "Manual follow-ups on a genuinely new VPS:"
echo "  1. Mikrus panel (https://mikr.us/panel/?a=domain): point SUBDOMAIN/DOMAIN_NAME"
echo "     from .env at this machine."
echo "  2. Set up the daily backup again: ~/.borg-backup.env (Bitwarden), then the"
echo "     systemd user timer (see docs/backup.md; loginctl enable-linger first)."
echo "  3. Log into n8n and spot-check a workflow + credential."
