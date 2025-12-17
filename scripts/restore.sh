#!/bin/bash
set -e

# BorgBackup Restore Script
# This script restores your project from a Borg backup on a new VPS
#
# Prerequisites:
# 1. Docker and Docker Compose must be installed
# 2. Borg must be installed
# 3. SSH key for BorgBase must be in ~/.ssh/
# 4. BORG_REPO and BORG_PASSPHRASE environment variables must be set

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== BorgBackup Disaster Recovery Restore ===${NC}"
echo "Time: $(date)"
echo ""

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed.${NC}"
    echo "Install with: curl -fsSL https://get.docker.com | sh"
    exit 1
fi
echo "  ✓ Docker is installed"

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not available.${NC}"
    exit 1
fi
echo "  ✓ Docker Compose is available"

# Check if Borg is installed
if ! command -v borg &> /dev/null; then
    echo -e "${RED}Error: Borg is not installed.${NC}"
    echo "Install with: sudo apt-get install -y borgbackup"
    exit 1
fi
echo "  ✓ Borg is installed"

# Check if BORG_REPO is set
if [ -z "$BORG_REPO" ]; then
    echo -e "${RED}Error: BORG_REPO environment variable is not set.${NC}"
    echo "Example: export BORG_REPO='ssh://xxx@xxx.repo.borgbase.com/./repo'"
    exit 1
fi
echo "  ✓ BORG_REPO is set: $BORG_REPO"

# Check if BORG_PASSPHRASE is set
if [ -z "$BORG_PASSPHRASE" ]; then
    echo -e "${RED}Error: BORG_PASSPHRASE environment variable is not set.${NC}"
    exit 1
fi
echo "  ✓ BORG_PASSPHRASE is set"

# Step 2: Determine restore location
echo -e "${YELLOW}[2/6] Setting up restore location...${NC}"

if [ -n "$1" ]; then
    RESTORE_DIR="$1"
else
    RESTORE_DIR="$HOME/sync-calendars"
fi

echo "  Project will be restored to: $RESTORE_DIR"

# Create restore directory if it doesn't exist
mkdir -p "$RESTORE_DIR"
cd "$RESTORE_DIR"

# Step 3: List available backups and select one
echo -e "${YELLOW}[3/6] Listing available backups...${NC}"
echo ""

borg list

echo ""
echo -e "${BLUE}Enter the backup name to restore (or press Enter for latest):${NC}"
read -r BACKUP_NAME

if [ -z "$BACKUP_NAME" ]; then
    # Get the latest backup
    BACKUP_NAME=$(borg list --short | tail -n 1)
    echo "  Using latest backup: $BACKUP_NAME"
fi

# Step 4: Extract the backup
echo -e "${YELLOW}[4/6] Extracting backup archive...${NC}"
echo "  This may take several minutes..."

borg extract "::$BACKUP_NAME"

echo -e "${GREEN}  ✓ Backup extracted${NC}"

# Step 5: Restore Docker volumes
echo -e "${YELLOW}[5/6] Restoring Docker volumes...${NC}"

# Check if volume dumps exist
if [ ! -f "backups/n8n_data.tar.gz" ] || [ ! -f "backups/redis_data.tar.gz" ]; then
    echo -e "${RED}Error: Volume backup files not found in backups/ directory${NC}"
    exit 1
fi

# Create Docker volumes if they don't exist
echo "  - Creating Docker volumes..."
docker volume create sync-calendars_n8n_data 2>/dev/null || true
docker volume create sync-calendars_redis_data 2>/dev/null || true

# Restore n8n_data volume
echo "  - Restoring n8n_data volume..."
docker run --rm \
    -v sync-calendars_n8n_data:/volume \
    -v "$RESTORE_DIR/backups:/backup" \
    alpine:latest \
    sh -c "rm -rf /volume/* /volume/..?* /volume/.[!.]* 2>/dev/null || true; tar xzf /backup/n8n_data.tar.gz -C /volume"

# Restore redis_data volume
echo "  - Restoring redis_data volume..."
docker run --rm \
    -v sync-calendars_redis_data:/volume \
    -v "$RESTORE_DIR/backups:/backup" \
    alpine:latest \
    sh -c "rm -rf /volume/* /volume/..?* /volume/.[!.]* 2>/dev/null || true; tar xzf /backup/redis_data.tar.gz -C /volume"

echo -e "${GREEN}  ✓ Docker volumes restored${NC}"

# Step 6: Create .env file reminder
echo -e "${YELLOW}[6/6] Final setup steps...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}  ⚠ WARNING: .env file not found!${NC}"
    echo "  You need to create a .env file with your secrets before starting the services."
    echo "  Use .env.example as a template:"
    echo "  cp .env.example .env"
    echo "  Then edit .env with your actual credentials and settings."
    echo ""
fi

# Clean up volume dumps
echo "  - Cleaning up temporary files..."
rm -f backups/*.tar.gz

echo -e "${GREEN}=== Restore Completed Successfully ===${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. If you haven't already, create and configure your .env file:"
echo "   cd $RESTORE_DIR"
echo "   cp .env.example .env"
echo "   nano .env  # Edit with your actual values"
echo ""
echo "2. Update SUBDOMAIN env with value from https://mikr.us/panel/?a=domain"
echo ""
echo "3. Start the services:"
echo "   cd $RESTORE_DIR"
echo "   docker compose up"
echo ""
echo -e "${GREEN}Your project has been restored to: $RESTORE_DIR${NC}"
