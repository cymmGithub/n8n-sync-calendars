# Backup & disaster recovery

Set up 2026-07-05. State backs up daily to BorgBase; code lives in this repo.

## Architecture

- **What:** `n8n_data` volume (SQLite DB + encryption key in `.n8n/config` — the
  officially required n8n backup set), `redis_data` volume, `.env`, `workflows/`.
  Code is NOT backed up — GitHub is the source of truth for it.
- **How:** `scripts/vps-backup.sh` daily at 03:30 Europe/Warsaw via systemd **user**
  timer `vps-backup.timer` (sysop has no sudo; crontab is blocked on this Mikrus LXC,
  but user-level systemd + linger works): stop containers → tar volumes (seconds of
  downtime) → start → borg upload → cleanup.
- **Where:** BorgBase repo `vps-mikrus-opony` (`fwk3187c`, eu). The VPS key is
  **append-only** — a compromised VPS cannot delete or alter backup history.
- **Pruning:** weekly from the workstation (full-access key): 7 daily / 4 weekly /
  6 monthly, then `borg compact`.
- **Alerting:** BorgBase emails after 2 days without a new archive. No news = good news.

## Secrets (Bitwarden note "VPS mikrus DR")

1. Borg passphrase  2. `borgbase_vps` SSH private key  3. repo URL
4. n8n encryption key (from `.n8n/config`, belt-and-suspenders)

On the VPS they live in `~/.borg-backup.env` (mode 600, outside the repo).

## Status commands (on VPS)

```bash
tail -50 ~/vps-backup.log                 # last runs
source ~/.borg-backup.env && borg list "$BORG_REPO"   # archives
systemctl --user list-timers vps-backup.timer         # schedule
```

## Disaster recovery

On a fresh machine: install docker + borg + git, export the three secrets from
Bitwarden, then:

```bash
git clone https://github.com/cymmGithub/n8n-sync-calendars.git
cd n8n-sync-calendars
./scripts/disaster-recovery.sh            # or with an archive name as $1
```

Rehearsed successfully on the workstation on 2026-07-05 (see repo history).
Only archives from `vps-backup.sh` (2026-07+) are restorable this way; the three
`backup-2025-12-*` archives predate this design (whole-project layout, no `.env`).

## Known quirks

- n8n service has no `restart:` policy in compose — after a VPS reboot n8n stays
  down until something runs `docker compose start` (the nightly backup does).
- Mikrus specifics after moving to a new VPS: re-point subdomain in the panel.
