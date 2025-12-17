#!/bin/bash
set -e

# BorgBackup Configuration
# Set these environment variables before running:
# - BORG_REPO: Your BorgBase repository URL (e.g., ssh://xxx@xxx.repo.borgbase.com/./repo)
# - BORG_PASSPHRASE: Your Borg repository passphrase

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Project directory (script assumes it's run from project root or within scripts/)
if [ -f "compose.yaml" ]; then
    PROJECT_DIR="$(pwd)"
elif [ -f "../compose.yaml" ]; then
    PROJECT_DIR="$(cd .. && pwd)"
else
    echo -e "${RED}Error: Cannot find compose.yaml. Run this script from the project root or scripts/ directory.${NC}"
    exit 1
fi

cd "$PROJECT_DIR"

# Backup directory for volume dumps
BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"

echo -e "${GREEN}=== Starting Backup Process ===${NC}"
echo "Time: $(date)"
echo "Project: $PROJECT_DIR"

# Check if BORG_REPO is set
if [ -z "$BORG_REPO" ]; then
    echo -e "${RED}Error: BORG_REPO environment variable is not set.${NC}"
    echo "Example: export BORG_REPO='ssh://xxx@xxx.repo.borgbase.com/./repo'"
    exit 1
fi

# Check if BORG_PASSPHRASE is set
if [ -z "$BORG_PASSPHRASE" ]; then
    echo -e "${RED}Error: BORG_PASSPHRASE environment variable is not set.${NC}"
    echo "Example: export BORG_PASSPHRASE='your-secure-passphrase'"
    exit 1
fi

# Step 1: Stop containers for consistent backup
echo -e "${YELLOW}[1/5] Stopping containers...${NC}"
docker compose stop

# Step 2: Dump Docker volumes to tar.gz files
echo -e "${YELLOW}[2/5] Dumping Docker volumes...${NC}"

# Dump n8n_data volume
echo "  - Backing up n8n_data volume..."
docker run --rm \
    -v "$(docker volume inspect sync-calendars_n8n_data --format '{{ .Mountpoint }}' 2>/dev/null || echo 'sync-calendars_n8n_data'):/volume" \
    -v "$BACKUP_DIR:/backup" \
    alpine:latest \
    tar czf /backup/n8n_data.tar.gz -C /volume .

# Dump redis_data volume
echo "  - Backing up redis_data volume..."
docker run --rm \
    -v "$(docker volume inspect sync-calendars_redis_data --format '{{ .Mountpoint }}' 2>/dev/null || echo 'sync-calendars_redis_data'):/volume" \
    -v "$BACKUP_DIR:/backup" \
    alpine:latest \
    tar czf /backup/redis_data.tar.gz -C /volume .

echo -e "${GREEN}  ✓ Volume dumps completed${NC}"

# Step 3: Create Borg backup
echo -e "${YELLOW}[3/5] Creating Borg backup archive...${NC}"

# Set backup name with timestamp
BACKUP_NAME="backup-$(date +%Y-%m-%d-%H%M%S)"

# Create the backup (excluding unnecessary files)
# We use '.' to backup relative paths, avoiding absolute path issues during restore
borg create \
    --stats \
    --compression lz4 \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '*.log' \
    --exclude '.env' \
    "::$BACKUP_NAME" \
    .

echo -e "${GREEN}  ✓ Borg backup created: $BACKUP_NAME${NC}"

# Step 4: Start containers again
echo -e "${YELLOW}[4/5] Starting containers...${NC}"
docker compose start

echo -e "${GREEN}  ✓ Containers restarted${NC}"

# Step 5: Prune old backups
echo -e "${YELLOW}[5/5] Pruning old backups...${NC}"
borg prune \
    --keep-daily 7 \
    --keep-weekly 4 \
    --keep-monthly 6 \
    --stats

echo -e "${GREEN}  ✓ Old backups pruned${NC}"

# Clean up local volume dumps (they're now in Borg)
echo "Cleaning up temporary volume dumps..."
rm -f "$BACKUP_DIR"/*.tar.gz

echo -e "${GREEN}=== Backup Completed Successfully ===${NC}"
echo "Time: $(date)"
echo "Repository: $BORG_REPO"
echo ""
echo "To list all backups, run: borg list"
echo "To view backup info, run: borg info ::$BACKUP_NAME"
