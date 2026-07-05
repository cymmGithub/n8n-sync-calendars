#!/bin/bash
set -euo pipefail

# Daily state backup to BorgBase (append-only key). See docs/backup.md.
# Requires ~/.borg-backup.env with BORG_REPO, BORG_PASSPHRASE, BORG_RSH.
# Cron: 30 3 * * * flock -n ~/.vps-backup.lock <repo>/scripts/vps-backup.sh >> ~/vps-backup.log 2>&1

source "$HOME/.borg-backup.env"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
mkdir -p backups

echo "[$(date -Is)] backup start"

# Containers are stopped only for the local tar snapshot (seconds),
# not for the upload. Trap guarantees restart even if tar fails.
cleanup() { docker compose start >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker compose stop
docker run --rm \
    -v sync-calendars_n8n_data:/volume:ro \
    -v "$PROJECT_DIR/backups:/backup" \
    alpine:latest tar cf /backup/n8n_data.tar -C /volume .
docker run --rm \
    -v sync-calendars_redis_data:/volume:ro \
    -v "$PROJECT_DIR/backups:/backup" \
    alpine:latest tar cf /backup/redis_data.tar -C /volume .
docker compose start
trap - EXIT

# Plain tar, not tar.gz: borg deduplicates uncompressed data across days;
# compression happens inside borg. A gzipped tar changes wholesale every
# day and would defeat deduplication.
borg create --stats --compression zstd,3 \
    "::backup-$(date +%Y-%m-%d-%H%M%S)" \
    backups/n8n_data.tar backups/redis_data.tar .env workflows

rm -f backups/*.tar

# No prune here: the VPS key is append-only by design (a compromised VPS
# must not be able to destroy history). Pruning runs weekly from a trusted
# machine with a full-access key.
echo "[$(date -Is)] backup done"
